// Переходы заявки на регистрацию (Phase 9a): отправка и отмена заявителем, решения проверяющего, очередь проверки.
// Каждая команда — одна транзакция: проверка перехода по статусу и роли действующего, запись статуса с проверкой
// версии, история, аудит и событие outbox (уведомления — worker).
import { Injectable } from '@nestjs/common';
import {
  type OnboardingApprove,
  onboardingProblems,
  type OnboardingRequestDto,
  type OnboardingReviewQuery,
  type OnboardingSubmit,
  type Page,
} from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import { OrganizationRegistryService } from '../../organizations';
import { OutboxService } from '../../outbox';
import { type OnboardingCommand, onboardingTransition } from '../domain/onboarding-rules';
import { OnboardingAccessService } from './onboarding-access.service';
import { OnboardingApprovalService } from './onboarding-approval.service';
import { ONBOARDING_INCLUDE } from './onboarding-mapper';
import { OnboardingService } from './onboarding.service';
import { completenessOf, stateOf } from './onboarding-state';
import { writeTransition } from './onboarding-store';

const notFound = (): DomainError => new DomainError('NOT_FOUND', { resource: 'onboarding_request' });

@Injectable()
export class OnboardingWorkflowService {
  constructor(
    private readonly db: PrismaService,
    private readonly requests: OnboardingService,
    private readonly access: OnboardingAccessService,
    private readonly approval: OnboardingApprovalService,
    private readonly organizations: OrganizationRegistryService,
    private readonly coaches: CoachesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private transition(
    row: Prisma.OnboardingRequestGetPayload<object>,
    command: OnboardingCommand,
    actor: 'APPLICANT' | 'PLATFORM' | 'ORGANIZATION',
  ) {
    const t = onboardingTransition(row, command, actor);
    if (!t.ok)
      throw new DomainError('INVALID_TRANSITION', { from: row.status, to: command, allowed: t.allowed });
    return t;
  }

  // ---------- Заявитель ----------

  /**
   * Отправка: согласие на обработку ПДн, полнота по сценарию (те же правила, что в форме), действующие ссылки,
   * отсутствие уже зарегистрированной организации. Повторная отправка — INVALID_TRANSITION / VERSION_CONFLICT.
   */
  async submit(
    user: AuthUser,
    id: string,
    version: number,
    _body: OnboardingSubmit,
  ): Promise<OnboardingRequestDto> {
    const rules = await this.requests.rules();
    await this.db.tx(async (tx) => {
      const row = await tx.onboardingRequest.findUnique({
        where: { id },
        include: { documents: { where: { deletedAt: null }, select: { typeCode: true } } },
      });
      if (!row || row.userId !== user.id) throw notFound();
      const t = this.transition(row, 'submit', 'APPLICANT');
      const state = stateOf(row);
      const problems = onboardingProblems(
        completenessOf(
          row.role,
          row.kind,
          state,
          row.documents.map((d) => d.typeCode),
        ),
        rules,
      );
      if (problems.length > 0) throw new DomainError('VALIDATION_FAILED', { fields: problems });
      await this.assertSubmittable(tx, user, row.id, row.role, row.kind, state);
      const template = await tx.consentTemplate.findFirst({
        where: { kind: 'PD_PROCESSING', publishedAt: { not: null }, retiredAt: null, locale: 'ru' },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      const now = new Date();
      await writeTransition(
        tx,
        row,
        version,
        t.to,
        {
          submittedAt: now,
          consentGivenAt: now,
          consentTemplateId: template?.id ?? null,
          decisionReason: null,
        },
        user.id,
        null,
      );
      await this.audit.record(tx, {
        action: 'onboarding.submitted',
        entityType: 'OnboardingRequest',
        entityId: id,
        organizationId: row.organizationId,
        before: { status: row.status },
        after: { status: t.to },
      });
      await this.outbox.enqueue(tx, {
        type: 'onboarding.submitted',
        aggregate: { type: 'OnboardingRequest', id },
        payload: { requestId: id, status: t.to },
      });
    });
    return this.requests.get(user, id);
  }

  private async assertSubmittable(
    tx: Tx,
    user: AuthUser,
    id: string,
    role: string,
    kind: string,
    state: ReturnType<typeof stateOf>,
  ): Promise<void> {
    if (state.organizationId && !(await this.organizations.isSelectable(tx, state.organizationId)))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'organizationId', code: 'not_found' }] });
    if (
      state.coachId &&
      state.organizationId &&
      !(await this.coaches.isSelectableIn(tx, state.coachId, state.organizationId))
    )
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'coachId', code: 'not_found' }] });
    if (role === 'ORGANIZATION_HEAD') await this.approval.assertOrganizationNotRegistered(tx, id, state);
    // Присоединение к организации, в которой тренер уже подтверждён, — повтор.
    if (kind === 'JOIN_ORGANIZATION' && role === 'COACH' && state.organizationId) {
      if (await this.organizations.hasActiveRole(tx, state.organizationId, user.id, 'COACH'))
        throw new DomainError('ALREADY_EXISTS', { resource: 'membership' });
    }
  }

  async cancel(user: AuthUser, id: string, version: number): Promise<OnboardingRequestDto> {
    await this.db.tx(async (tx) => {
      const row = await tx.onboardingRequest.findUnique({ where: { id } });
      if (!row || row.userId !== user.id) throw notFound();
      const t = this.transition(row, 'cancel', 'APPLICANT');
      await writeTransition(tx, row, version, t.to, {}, user.id, null);
      await this.audit.record(tx, {
        action: 'onboarding.cancelled',
        entityType: 'OnboardingRequest',
        entityId: id,
        before: { status: row.status },
        after: { status: t.to },
      });
      await this.outbox.enqueue(tx, {
        type: 'onboarding.cancelled',
        aggregate: { type: 'OnboardingRequest', id },
        payload: { requestId: id },
      });
    });
    return this.requests.get(user, id);
  }

  // ---------- Проверяющий ----------

  /** Очередь проверки: только заявки, которые пользователь вправе видеть как проверяющий; фильтры — роль, статус, дата. */
  async queue(user: AuthUser, q: OnboardingReviewQuery): Promise<Page<OnboardingRequestDto>> {
    const visible = await this.access.reviewFilter(user);
    if (!visible) throw new DomainError('FORBIDDEN', { permission: 'onboarding.review' });
    const and: Prisma.OnboardingRequestWhereInput[] = [visible];
    if (q.pending) and.push({ status: { in: ['PENDING_REVIEW', 'PENDING_ORGANIZATION_APPROVAL'] } });
    if (q.from) and.push({ submittedAt: { gte: new Date(`${q.from}T00:00:00.000Z`) } });
    if (q.to)
      and.push({ submittedAt: { lt: new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      const at = new Date(cursor.k);
      and.push({ OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: cursor.id } }] });
    }
    const rows = await this.db.onboardingRequest.findMany({
      where: { AND: and, role: q.role, status: q.status, kind: q.kind, organizationId: q.organizationId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: ONBOARDING_INCLUDE,
    });
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.updatedAt.toISOString(), id: r.id }),
      (r) => r,
    );
    return {
      data: await Promise.all(page.data.map((r) => this.requests.toDto(user, r, true))),
      page: page.page,
    };
  }

  private async decide(
    user: AuthUser,
    id: string,
    version: number,
    command: 'approve' | 'reject' | 'request_changes',
    reason: string | null,
  ): Promise<OnboardingRequestDto> {
    await this.db.tx(async (tx) => {
      const row = await tx.onboardingRequest.findUnique({ where: { id } });
      if (!row) throw notFound();
      const actor = await this.access.reviewerRole(user, row);
      if (!actor) {
        if (row.userId === user.id || (await this.access.canViewAsReviewer(user, row)))
          throw new DomainError('FORBIDDEN', { permission: 'onboarding.review' });
        throw notFound();
      }
      const t = this.transition(row, command, actor);
      if (t.reasonRequired && !reason) throw new DomainError('REASON_REQUIRED');
      const effects = command === 'approve' ? await this.approval.apply(tx, row, user.id) : null;
      const decided = command !== 'request_changes';
      await writeTransition(
        tx,
        row,
        version,
        t.to,
        {
          decisionReason: reason,
          ...(decided ? { decidedAt: new Date(), decidedById: user.id } : {}),
          ...(effects?.resultOrganizationId ? { resultOrganizationId: effects.resultOrganizationId } : {}),
        },
        user.id,
        reason,
      );
      await this.audit.record(tx, {
        action:
          command === 'approve'
            ? 'onboarding.approved'
            : command === 'reject'
              ? 'onboarding.rejected'
              : 'onboarding.changes_requested',
        entityType: 'OnboardingRequest',
        entityId: id,
        organizationId: row.organizationId ?? effects?.resultOrganizationId ?? null,
        before: { status: row.status },
        after: { status: t.to, reviewer: actor },
        reason,
      });
      if (command === 'request_changes') {
        await this.outbox.enqueue(tx, {
          type: 'onboarding.changes_requested',
          aggregate: { type: 'OnboardingRequest', id },
          payload: { requestId: id },
        });
      } else {
        await this.outbox.enqueue(tx, {
          type: 'onboarding.decided',
          aggregate: { type: 'OnboardingRequest', id },
          payload: { requestId: id, status: t.to },
        });
      }
    });
    return this.requests.get(user, id);
  }

  approve(
    user: AuthUser,
    id: string,
    version: number,
    body: OnboardingApprove,
  ): Promise<OnboardingRequestDto> {
    return this.decide(user, id, version, 'approve', body.comment?.trim() || null);
  }

  reject(user: AuthUser, id: string, version: number, reason: string): Promise<OnboardingRequestDto> {
    return this.decide(user, id, version, 'reject', reason);
  }

  requestChanges(user: AuthUser, id: string, version: number, reason: string): Promise<OnboardingRequestDto> {
    return this.decide(user, id, version, 'request_changes', reason);
  }
}
