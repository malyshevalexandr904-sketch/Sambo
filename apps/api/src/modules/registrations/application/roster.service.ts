// Заявка тренера списком (правки 09.11.2026, п. 3): спортсмены организации (у тренера — свои) с подходящими
// категориями и готовностью документов допуска; добавление нескольких спортсменов одним запросом; комиссия по допуску
// — решение по заявке клуба целиком; при окончании регистрации — исключение спортсменов, не приведших документы
// в порядок.
import { Injectable } from '@nestjs/common';
import {
  type ApplicationCommissionRequest,
  type ApplicationDocumentsRow,
  type DocumentReadinessDto,
  documentReadiness,
  type EntriesBulkCreate,
  type EntriesBulkResult,
  fullYearsOn,
  isReadinessBlocking,
  type ReadinessDocumentFact,
  type RosterDto,
} from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import { type CompetitionBasics, CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { ACTIVE_ENTRY_STATUSES } from '../domain/entry-rules';
import { currentPeriod } from './application-effects';
import { EligibilityService } from './eligibility.service';
import { EntriesService } from './entries.service';
import { lockApplication } from './entry-commands';
import { RegistrationAccessService } from './registration-access.service';

/** Причина автоматического исключения при окончании регистрации (видна тренеру и спортсмену). */
export const DOCUMENTS_NOT_READY_REASON =
  'Документы не приведены в порядок до окончания регистрации: нет документа или истёк срок действия';

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** Документы спортсменов: нужные для допуска, общие или на этот турнир. */
export async function readinessFacts(
  db: Tx | PrismaService,
  competitionId: string,
  athleteIds: string[],
): Promise<Map<string, ReadinessDocumentFact[]>> {
  const rows =
    athleteIds.length === 0
      ? []
      : await db.document.findMany({
          where: {
            deletedAt: null,
            athleteId: { in: athleteIds },
            OR: [{ competitionId: null }, { competitionId }],
          },
          select: { athleteId: true, typeCode: true, status: true, expirationDate: true },
        });
  const out = new Map<string, ReadinessDocumentFact[]>();
  for (const r of rows) {
    if (!r.athleteId) continue;
    const list = out.get(r.athleteId) ?? [];
    list.push({
      typeCode: r.typeCode,
      status: r.status,
      expirationDate: r.expirationDate ? dateOnly(r.expirationDate) : null,
    });
    out.set(r.athleteId, list);
  }
  return out;
}

/** Возраст на дату начала турнира и наличие разряда — от них зависит набор документов. */
export async function readinessOf(
  db: Tx | PrismaService,
  competition: { id: string; startDate: string },
  athleteIds: string[],
): Promise<Map<string, DocumentReadinessDto>> {
  const ids = [...new Set(athleteIds)];
  const [athletes, docs] = await Promise.all([
    db.athleteProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        person: { select: { birthDate: true } },
        ranks: { where: { revokedAt: null }, select: { id: true }, take: 1 },
      },
    }),
    readinessFacts(db, competition.id, ids),
  ]);
  return new Map(
    athletes.map((a) => [
      a.id,
      documentReadiness(
        fullYearsOn(dateOnly(a.person.birthDate), competition.startDate),
        a.ranks.length > 0,
        docs.get(a.id) ?? [],
        competition.startDate,
      ),
    ]),
  );
}

@Injectable()
export class RosterService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly eligibility: EligibilityService,
    private readonly athletes: AthleteAccessService,
    private readonly coaches: CoachesService,
    private readonly entries: EntriesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private basics(c: CompetitionBasics): { id: string; startDate: string } {
    return { id: c.id, startDate: c.startDate };
  }

  /**
   * Спортсмены для заявки: тренер видит своих спортсменов клуба, руководитель клуба — всех действующих спортсменов
   * клуба. Каждый — с категориями турнира, куда его можно заявить, и готовностью документов.
   */
  async roster(user: AuthUser, competitionId: string, organizationId: string): Promise<RosterDto> {
    const competition = await this.competitions.require(competitionId);
    if (competition.status === 'DRAFT') throw new DomainError('NOT_FOUND', { resource: 'competition' });
    await this.policy.assert(
      user,
      'registration.create',
      await this.access.organizationScope(organizationId),
    );
    const coachId = user.activeRole === 'COACH' ? await this.coaches.coachIdOfUser(user) : null;
    if (user.activeRole === 'COACH' && !coachId) return { competitionId, organizationId, athletes: [] };
    const rows = await this.db.athleteProfile.findMany({
      where: {
        status: 'ACTIVE',
        memberships: { some: { organizationId, ...currentPeriod() } },
        ...(coachId ? { coaches: { some: { coachId, ...currentPeriod() } } } : {}),
      },
      select: { id: true, person: { select: { lastName: true, firstName: true } } },
      orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }],
      take: 500,
    });
    const ids = rows.map((r) => r.id);
    const [readiness, entered] = await Promise.all([
      readinessOf(this.db, this.basics(competition), ids),
      this.db.entry.findMany({
        where: { competitionId, athleteId: { in: ids }, status: { in: [...ACTIVE_ENTRY_STATUSES] } },
        select: { id: true, athleteId: true, applicationId: true, categoryId: true, status: true },
      }),
    ]);
    const enteredBy = new Map(entered.map((e) => [e.athleteId, e]));
    const athletes: RosterDto['athletes'] = [];
    for (const id of ids) {
      const info = await this.athletes.registrationInfo(id);
      if (!info) continue;
      const evaluation = await this.eligibility.evaluate(null, competition, info);
      const e = enteredBy.get(id);
      athletes.push({
        athleteId: id,
        lastName: info.lastName,
        firstName: info.firstName,
        middleName: info.middleName,
        birthDate: info.birthDate,
        gender: info.gender,
        age: fullYearsOn(info.birthDate, competition.startDate),
        rankCode: info.rankCode,
        coachName: info.coachName,
        documents: readiness.get(id) ?? { state: 'MISSING', missing: [], expired: [], pending: [] },
        eligible: evaluation.eligible.map(({ category: c, weightMatch }) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          gender: c.gender,
          weight: c.weight,
          weightMatch,
        })),
        entered: e
          ? { entryId: e.id, applicationId: e.applicationId, categoryId: e.categoryId, status: e.status }
          : null,
      });
    }
    return { competitionId, organizationId, athletes };
  }

  /** Несколько спортсменов в заявку: каждый — той же командой, что одиночное добавление; ошибки — по спортсмену. */
  async addBulk(user: AuthUser, applicationId: string, req: EntriesBulkCreate): Promise<EntriesBulkResult> {
    const result: EntriesBulkResult = { added: 0, failed: [] };
    for (const item of req.items) {
      try {
        await this.entries.add(user, applicationId, item);
        result.added += 1;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        result.failed.push({ athleteId: item.athleteId, code: e.code });
      }
    }
    return result;
  }

  /** Готовность документов участников заявки — для комиссии по допуску. */
  async applicationDocuments(user: AuthUser, applicationId: string): Promise<ApplicationDocumentsRow[]> {
    const ctx = await this.access.applicationContext(applicationId);
    const staff = await this.policy.can(user, 'registration.view', ctx.competitionScope);
    if (!staff && !(await this.access.isOwner(user, ctx.application.organizationId)))
      throw new DomainError('NOT_FOUND', { resource: 'application' });
    const rows = await this.db.entry.findMany({
      where: { applicationId, status: { in: [...ACTIVE_ENTRY_STATUSES, 'REJECTED'] } },
      select: { id: true, athleteId: true },
    });
    const readiness = await readinessOf(
      this.db,
      this.basics(ctx.competition),
      rows.map((r) => r.athleteId),
    );
    return rows.map((r) => ({
      entryId: r.id,
      athleteId: r.athleteId,
      documents: readiness.get(r.athleteId) ?? { state: 'MISSING', missing: [], expired: [], pending: [] },
    }));
  }

  /**
   * Комиссия по допуску (правки 09.11.2026): «Одобрить» — все нерассмотренные участники заявки одобряются и заявка
   * одобряется; «Отказать» — с причиной: заявка и все её действующие участники отклоняются.
   */
  async commission(user: AuthUser, applicationId: string, req: ApplicationCommissionRequest): Promise<void> {
    const ctx = await this.access.applicationContext(applicationId);
    const permission = req.decision === 'APPROVE' ? 'registration.approve' : 'registration.reject';
    const { viaPlatform } = await this.policy.assert(user, permission, ctx.competitionScope);
    const allowed = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
    if (!allowed.includes(ctx.competition.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_status'] });
    await this.db.tx(async (tx) => {
      const app = await lockApplication(tx, applicationId);
      const from = app.status;
      if (!['SUBMITTED', 'UNDER_REVIEW', 'WAITING_DOCUMENTS', 'APPROVED'].includes(from))
        throw new DomainError('INVALID_TRANSITION', { from, to: req.decision, allowed: [] });
      const now = new Date();
      const status = req.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const touched = await tx.entry.findMany({
        where: {
          applicationId,
          status: req.decision === 'APPROVE' ? 'PENDING' : { in: [...ACTIVE_ENTRY_STATUSES] },
        },
        select: { id: true },
      });
      await tx.entry.updateMany({
        where: { id: { in: touched.map((e) => e.id) } },
        data: {
          status,
          decidedAt: now,
          decidedById: user.id,
          decisionReason: req.decision === 'REJECT' ? (req.reason ?? null) : null,
          version: { increment: 1 },
        },
      });
      await tx.application.update({
        where: { id: applicationId },
        data: {
          status,
          reviewedAt: now,
          reviewedById: user.id,
          reviewComment: req.reason ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'application.status_changed',
        entityType: 'Application',
        entityId: applicationId,
        competitionId: ctx.competition.id,
        organizationId: ctx.application.organizationId,
        before: { status: from },
        after: { status, entries: touched.length, trigger: 'admission_commission' },
        reason: req.reason ?? null,
        platformIntervention: viaPlatform,
      });
      for (const e of touched)
        await this.outbox.enqueue(tx, {
          type: 'registration.entry_decided',
          aggregate: { type: 'Entry', id: e.id },
          competitionId: ctx.competition.id,
          payload: { entryId: e.id, decision: status },
        });
      await this.outbox.enqueue(tx, {
        type: 'registration.application_decided',
        aggregate: { type: 'Application', id: applicationId },
        competitionId: ctx.competition.id,
        payload: { applicationId, status },
      });
    });
  }

  /**
   * Окончание регистрации (правки 09.11.2026): спортсмены поданных заявок, у которых документа нет или истёк срок,
   * исключаются из заявки (участие отклоняется с причиной). Загруженные и ждущие модерации остаются — их смотрит
   * комиссия по допуску. Тот же расчёт делает фоновая задача, закрывающая регистрацию по сроку.
   */
  async removeNotReady(tx: Tx, competition: { id: string; startDate: string }, userId: string | null) {
    const entries = await tx.entry.findMany({
      where: {
        competitionId: competition.id,
        status: { in: [...ACTIVE_ENTRY_STATUSES] },
        application: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
      },
      select: { id: true, athleteId: true, application: { select: { id: true, organizationId: true } } },
    });
    const readiness = await readinessOf(
      tx,
      competition,
      entries.map((e) => e.athleteId),
    );
    const removed = entries.filter((e) => {
      const r = readiness.get(e.athleteId);
      return !r || isReadinessBlocking(r.state);
    });
    if (removed.length === 0) return 0;
    const now = new Date();
    await tx.entry.updateMany({
      where: { id: { in: removed.map((e) => e.id) } },
      data: {
        status: 'REJECTED',
        decidedAt: now,
        decidedById: userId,
        decisionReason: DOCUMENTS_NOT_READY_REASON,
        version: { increment: 1 },
      },
    });
    for (const e of removed) {
      await this.audit.record(tx, {
        action: 'entry.decided',
        entityType: 'Entry',
        entityId: e.id,
        competitionId: competition.id,
        organizationId: e.application.organizationId,
        after: { status: 'REJECTED', trigger: 'registration_closed_documents' },
        reason: DOCUMENTS_NOT_READY_REASON,
      });
      await this.outbox.enqueue(tx, {
        type: 'registration.entry_decided',
        aggregate: { type: 'Entry', id: e.id },
        competitionId: competition.id,
        payload: { entryId: e.id, decision: 'REJECTED' },
      });
    }
    return removed.length;
  }
}
