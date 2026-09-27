// Допуск участия (API.md, 5.4): просмотр, исключение проверки с причиной, пересчёт, список мандатной комиссии.
import { Injectable } from '@nestjs/common';
import {
  ADMISSION_CHECK_KINDS,
  type AdmissionCheckDto,
  type AdmissionCheckKind,
  type AdmissionDto,
  type AdmissionQuery,
  type AdmissionRow,
  type AdmissionSummary,
  type Page,
} from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { AuditService } from '../../audit';
import { type CompetitionScope, CompetitionScopeService } from '../../competitions';
import { RegistrationAccessService } from '../../registrations';
import { WriteLeaseService } from '../../venue-sync';
import { canWaive } from '../domain/admission-rules';
import { AdmissionEngine } from './admission-engine';
import {
  ENTRY_VIEW_SELECT,
  entryCursor,
  entrySearch,
  organizationOf,
  toAthleteBrief,
  toCategoryRef,
} from './entry-views';

const ADMISSION_INCLUDE = { checks: true } satisfies Prisma.AdmissionInclude;
type AdmissionRecord = Prisma.AdmissionGetPayload<{ include: typeof ADMISSION_INCLUDE }>;

const ORDER = new Map(ADMISSION_CHECK_KINDS.map((k, i) => [k, i]));

function toCheckDto(c: AdmissionRecord['checks'][number]): AdmissionCheckDto {
  return {
    kind: c.kind,
    status: c.status,
    reasonCode: c.reasonCode as AdmissionCheckDto['reasonCode'],
    reasonParams: (c.reasonParams as Record<string, unknown> | null) ?? null,
    waiverReason: c.waiverReason,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Допуск без проекции (пересчёт недоступен: право записи у узла) — ждёт пересчёта. */
const UNKNOWN = (entryId: string): AdmissionDto => ({
  entryId,
  status: 'PENDING',
  decidedAt: null,
  checks: [],
  allowedActions: [],
});

export function toAdmissionDto(entryId: string, a: AdmissionRecord | null, override: boolean): AdmissionDto {
  if (!a) return UNKNOWN(entryId);
  const checks = [...a.checks]
    .sort((x, y) => (ORDER.get(x.kind) ?? 0) - (ORDER.get(y.kind) ?? 0))
    .map(toCheckDto);
  return {
    entryId,
    status: a.status,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    checks,
    allowedActions: override ? checks.filter((c) => canWaive(c.status)).map((c) => `waive:${c.kind}`) : [],
  };
}

export function toAdmissionSummary(
  a: { status: AdmissionSummary['status']; checks: AdmissionRecord['checks'] } | null,
): AdmissionSummary {
  if (!a) return { status: 'PENDING', failed: [], pending: [] };
  return {
    status: a.status,
    failed: a.checks.filter((c) => c.status === 'FAILED').map((c) => c.kind),
    pending: a.checks.filter((c) => c.status === 'PENDING').map((c) => c.kind),
  };
}

@Injectable()
export class AdmissionService {
  constructor(
    private readonly db: PrismaService,
    private readonly engine: AdmissionEngine,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly athletes: AthleteAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
  ) {}

  /** Пересчёт в транзакции команды соседнего модуля (прибытие, взвешивание, медицина). */
  recompute(tx: Tx, where: Prisma.EntryWhereInput, now?: Date): Promise<void> {
    return this.engine.recompute(tx, where, now);
  }

  /** Допуск участия; проекции нет — пересчитывается (если право записи у облака). */
  async dtoOf(entryId: string, override: boolean, tx?: Tx): Promise<AdmissionDto> {
    const db = tx ?? this.db;
    let a = await db.admission.findUnique({ where: { entryId }, include: ADMISSION_INCLUDE });
    if (!a) {
      const materialize = async (t: Tx): Promise<void> => this.engine.recompute(t, { id: entryId });
      if (tx) await materialize(tx);
      else await this.db.tx(materialize);
      a = await db.admission.findUnique({ where: { entryId }, include: ADMISSION_INCLUDE });
    }
    return toAdmissionDto(entryId, a, override);
  }

  async summaries(entryIds: string[], tx?: Tx): Promise<Map<string, AdmissionSummary>> {
    const rows = await (tx ?? this.db).admission.findMany({
      where: { entryId: { in: entryIds } },
      include: ADMISSION_INCLUDE,
    });
    const byEntry = new Map(rows.map((r) => [r.entryId, r]));
    return new Map(entryIds.map((id) => [id, toAdmissionSummary(byEntry.get(id) ?? null)]));
  }

  private canOverride(user: AuthUser, scope: CompetitionScope): Promise<boolean> {
    return this.policy.can(user, 'admission.override', scope);
  }

  /**
   * Допуск видят персонал с `admission.view`, владелец заявки, сам спортсмен и подтверждённый представитель
   * (API.md, 5.4). Персоналу без права — 403, остальным — 404.
   */
  async get(user: AuthUser, entryId: string): Promise<AdmissionDto> {
    const ctx = await this.access.entryContext(entryId);
    const scope = ctx.competitionScope;
    if (await this.policy.can(user, 'admission.view', scope))
      return this.dtoOf(entryId, ctx.entry.status === 'APPROVED' && (await this.canOverride(user, scope)));
    const rel = await this.athletes.relation(user, ctx.entry.athleteId);
    const personal = rel.relation === 'SELF' || (rel.relation === 'GUARDIAN' && rel.verified);
    if (personal || (await this.access.isOwner(user, ctx.application.organizationId)))
      return this.dtoOf(entryId, false);
    await this.access.assertVisible(user, ctx);
    throw new DomainError('FORBIDDEN', { permission: 'admission.view' });
  }

  /** Пересчёт по запросу персонала (API.md, 5.4): после исправлений вне системы событий. */
  async recomputeEntry(user: AuthUser, entryId: string): Promise<AdmissionDto> {
    const ctx = await this.access.entryContext(entryId);
    await this.db.tx((tx) => this.engine.recompute(tx, { id: entryId }));
    return this.dtoOf(entryId, await this.canOverride(user, ctx.competitionScope));
  }

  /**
   * Пересчёт допуска турнира: после изменений без событий (истечение документов регламентной задачей worker,
   * конец окон повторного взвешивания). Возвращает число участий по статусам.
   */
  async recomputeCompetition(competitionId: string): Promise<Record<string, number>> {
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await this.engine.recompute(tx, { competitionId });
    });
    const groups = await this.db.admission.groupBy({
      by: ['status'],
      where: { competitionId, entry: { status: 'APPROVED' } },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  /** Исключение проверки из допуска с причиной (право `admission.override`); пройденную исключать незачем. */
  async waive(
    user: AuthUser,
    entryId: string,
    kind: AdmissionCheckKind,
    reason: string,
  ): Promise<AdmissionDto> {
    const ctx = await this.access.entryContext(entryId);
    const { viaPlatform } = await this.policy.assert(user, 'admission.override', ctx.competitionScope);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, ctx.entry.competitionId);
      const entry = await tx.entry.findUniqueOrThrow({ where: { id: entryId }, select: { status: true } });
      if (entry.status !== 'APPROVED')
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['entry_not_approved'] });
      await this.engine.recompute(tx, { id: entryId });
      const check = await tx.admissionCheck.findFirst({ where: { admission: { entryId }, kind } });
      if (!check) throw new DomainError('NOT_FOUND', { resource: 'admission_check' });
      if (!canWaive(check.status))
        throw new DomainError('INVALID_TRANSITION', { from: check.status, to: 'WAIVED', allowed: [] });
      await tx.admissionCheck.update({
        where: { id: check.id },
        data: { status: 'WAIVED', waiverReason: reason, updatedById: user.id },
      });
      await this.engine.recompute(tx, { id: entryId });
      await this.audit.record(tx, {
        action: 'admission.check_waived',
        entityType: 'Entry',
        entityId: entryId,
        competitionId: ctx.entry.competitionId,
        organizationId: ctx.application.organizationId,
        before: { kind, status: check.status, reasonCode: check.reasonCode },
        after: { kind, status: 'WAIVED' },
        reason,
        platformIntervention: viaPlatform,
      });
    });
    return this.dtoOf(entryId, true);
  }

  /** Мандатная комиссия (API.md, 5.4): одобренные участия с допуском, прибытием и взвешиванием. */
  async list(user: AuthUser, competitionId: string, q: AdmissionQuery): Promise<Page<AdmissionRow>> {
    const scope = await this.competitions.scopeOf(competitionId);
    const override = await this.canOverride(user, scope);
    const rows = await this.db.entry.findMany({
      where: { AND: listWhere(competitionId, q) },
      orderBy: [{ snapLastName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      select: {
        ...ENTRY_VIEW_SELECT,
        admission: { include: ADMISSION_INCLUDE },
        weighInRecord: { select: { status: true, lastAttempt: { select: { weightGrams: true } } } },
      },
    });
    const checkIns = await this.db.checkIn.findMany({
      where: { competitionId, athleteId: { in: rows.map((r) => r.athleteId) } },
      select: { athleteId: true, status: true },
    });
    const arrival = new Map(checkIns.map((c) => [c.athleteId, c.status]));
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.snapLastName, id: r.id }),
      (r): AdmissionRow => ({
        entryId: r.id,
        athlete: toAthleteBrief(r),
        organization: organizationOf(r),
        category: toCategoryRef(r.category),
        admission: toAdmissionDto(r.id, r.admission, override),
        checkIn: { status: arrival.get(r.athleteId) ?? 'EXPECTED' },
        weighIn: {
          status: r.weighInRecord?.status ?? 'EXPECTED',
          lastWeightGrams: r.weighInRecord?.lastAttempt?.weightGrams ?? null,
        },
      }),
    );
  }
}

function listWhere(competitionId: string, q: AdmissionQuery): Prisma.EntryWhereInput[] {
  const and: Prisma.EntryWhereInput[] = [{ competitionId, status: 'APPROVED' }];
  if (q.categoryId) and.push({ categoryId: q.categoryId });
  if (q.status === 'PENDING') and.push({ OR: [{ admission: null }, { admission: { status: 'PENDING' } }] });
  else if (q.status) and.push({ admission: { status: q.status } });
  if (q.checkKind)
    and.push({
      admission: { checks: { some: { kind: q.checkKind, status: { in: ['PENDING', 'FAILED'] } } } },
    });
  if (q.problemsOnly) and.push({ OR: [{ admission: null }, { admission: { status: { not: 'ADMITTED' } } }] });
  and.push(...entrySearch(q.q), ...entryCursor(decodeCursor(q.cursor)));
  return and;
}
