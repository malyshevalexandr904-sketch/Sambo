// Решения персонала по участиям (API.md, 5.3): одобрение и отклонение, снятие, перевод в другую категорию.
// Снятие доступно и владельцу заявки — до окончания регистрации.
import { Injectable } from '@nestjs/common';
import type {
  EntryDecisionRequest,
  EntryDto,
  EntryTransferRequest,
  EntryWithdrawRequest,
} from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CompetitionCategoriesService, isActiveCategory } from '../../categories';
import { CompetitionScopeService, registrationWindow } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { isUnderStaffReview } from '../domain/application-machine';
import { decisionAllowed, isActiveEntry } from '../domain/entry-rules';
import { EligibilityService } from './eligibility.service';
import { EntriesService } from './entries.service';
import {
  assertTransferable,
  athleteFromSnapshot,
  blocked,
  DECISION_PHASE,
  eligibilityError,
  invalidDecision,
  isUniqueViolation,
  lockApplication,
  lockAthleteInCompetition,
  lockEntry,
} from './entry-commands';
import { RegistrationAccessService } from './registration-access.service';

type ApplicationRow = Awaited<ReturnType<typeof lockApplication>>;

@Injectable()
export class EntryDecisionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly entries: EntriesService,
    private readonly access: RegistrationAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly categories: CompetitionCategoriesService,
    private readonly eligibility: EligibilityService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Решение по участнику (API.md, 5.3): одобрить (`registration.approve`) или отклонить с причиной
   * (`registration.reject`). Первое решение по поданной заявке берёт её в работу (UNDER_REVIEW).
   */
  async decide(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryDecisionRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    const permission = req.decision === 'APPROVED' ? 'registration.approve' : 'registration.reject';
    const viaPlatform = await this.access.assertStaff(user, permission, ctx);
    const reason = req.reason?.trim() || null;
    if (req.decision === 'REJECTED' && !reason) throw new DomainError('REASON_REQUIRED');
    await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.competitions.require(competitionId);
      if (!DECISION_PHASE.includes(competition.status)) throw blocked('competition_status');
      const app = await lockApplication(tx, ctx.application.id);
      if (!isUnderStaffReview(app.status)) throw blocked('application_not_under_review');
      const entry = await lockEntry(tx, entryId, version);
      if (!decisionAllowed(entry.status, req.decision)) throw invalidDecision(entry.status, req.decision);
      if (req.decision === 'APPROVED') {
        const category = await this.categories.spec(entry.categoryId, tx);
        if (!category || !isActiveCategory(category.status)) throw blocked('category_inactive');
      }
      if (app.status === 'SUBMITTED') await this.takeIntoReview(tx, app, user.id);
      try {
        await tx.entry.update({
          where: { id: entryId },
          data: {
            status: req.decision,
            decidedAt: new Date(),
            decidedById: user.id,
            decisionReason: req.decision === 'REJECTED' ? reason : null,
            version: { increment: 1 },
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainError('ATHLETE_ALREADY_ENTERED');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'entry.decided',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: app.organizationId,
        before: { status: entry.status },
        after: { status: req.decision },
        reason,
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_decided',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: { entryId, decision: req.decision },
      });
    });
    return this.entries.get(user, entryId);
  }

  /**
   * Снятие участника: владелец заявки — до окончания регистрации, персонал — с `entry.withdraw`.
   * Снятие после жеребьёвки (поражения неявкой в незавершённых схватках) подключат Phase 5–7.
   */
  async withdraw(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryWithdrawRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    const staff = await this.access.canStaff(user, 'entry.withdraw', ctx.competitionScope);
    if (!staff) {
      const owner = await this.access.isOwner(user, ctx.application.organizationId);
      if (!owner) {
        await this.access.assertVisible(user, ctx);
        throw new DomainError('FORBIDDEN', { permission: 'entry.withdraw' });
      }
      if (registrationWindow(ctx.competition, new Date()) !== 'OPEN')
        throw new DomainError('REGISTRATION_CLOSED', {
          registrationEndsAt: ctx.competition.registrationEndsAt.toISOString(),
        });
    }
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, ctx.application.competitionId);
      await lockApplication(tx, ctx.application.id);
      const entry = await lockEntry(tx, entryId, version);
      if (!isActiveEntry(entry.status))
        throw new DomainError('INVALID_TRANSITION', { from: entry.status, to: 'WITHDRAWN', allowed: [] });
      await tx.entry.update({
        where: { id: entryId },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: new Date(),
          withdrawnById: user.id,
          withdrawReason: req.reason,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'entry.withdrawn',
        entityType: 'Entry',
        entityId: entryId,
        competitionId: entry.competitionId,
        organizationId: ctx.application.organizationId,
        before: { status: entry.status },
        after: { status: 'WITHDRAWN' },
        reason: req.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_withdrawn',
        aggregate: { type: 'Entry', id: entryId },
        competitionId: entry.competitionId,
        payload: { entryId },
      });
    });
    return this.entries.get(user, entryId);
  }

  /**
   * Перевод в другую категорию (`entry.transfer`): обе категории — до жеребьёвки, совместимость — по снимку
   * участия. Заявленная категория сохраняется.
   */
  async transfer(
    user: AuthUser,
    entryId: string,
    version: number,
    req: EntryTransferRequest,
  ): Promise<EntryDto> {
    const ctx = await this.access.entryContext(entryId);
    await this.db.tx(async (tx) => {
      const competitionId = ctx.application.competitionId;
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.competitions.require(competitionId);
      if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(competition.status))
        throw blocked('competition_closed');
      const entry = await lockEntry(tx, entryId, version);
      if (!isActiveEntry(entry.status))
        throw new DomainError('INVALID_TRANSITION', { from: entry.status, to: 'TRANSFERRED', allowed: [] });
      const [from, to] = await Promise.all([
        this.categories.spec(entry.categoryId, tx),
        this.categories.spec(req.toCategoryId, tx),
      ]);
      assertTransferable(entry, from, to);
      await lockAthleteInCompetition(tx, competitionId, entry.athleteId);
      const evaluation = await this.eligibility.evaluate(tx, competition, athleteFromSnapshot(entry), {
        excludeEntryId: entryId,
        ignoreCategoryStatus: true,
      });
      const refused = evaluation.ineligible.find((i) => i.category.id === to.id);
      if (refused) throw eligibilityError(refused.reasons.filter((r) => r !== 'MAX_CATEGORIES_REACHED'));
      try {
        await tx.entry.update({
          where: { id: entryId },
          data: { categoryId: to.id, version: { increment: 1 } },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainError('ATHLETE_ALREADY_ENTERED');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'entry.transferred',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: ctx.application.organizationId,
        before: { categoryId: entry.categoryId },
        after: { categoryId: to.id },
        reason: req.reason,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_transferred',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: { entryId, fromCategoryId: entry.categoryId, toCategoryId: to.id },
      });
    });
    return this.entries.get(user, entryId);
  }

  /** Первое решение по поданной заявке берёт её в работу: SUBMITTED → UNDER_REVIEW. */
  private async takeIntoReview(tx: Tx, app: ApplicationRow, userId: string): Promise<void> {
    await tx.application.update({
      where: { id: app.id },
      data: {
        status: 'UNDER_REVIEW',
        reviewedAt: new Date(),
        reviewedById: userId,
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'application.status_changed',
      entityType: 'Application',
      entityId: app.id,
      competitionId: app.competitionId,
      organizationId: app.organizationId,
      before: { status: 'SUBMITTED' },
      after: { status: 'UNDER_REVIEW' },
    });
  }
}
