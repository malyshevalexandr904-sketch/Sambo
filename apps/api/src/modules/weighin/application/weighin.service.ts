// Взвешивание (API.md, 5.6; D-06): запись попытки с проверками окна, весов, прибытия и вида попытки; список
// экрана взвешивания; история попыток; подсказка категорий для перевода.
import { Injectable } from '@nestjs/common';
import {
  attemptKindsForWindow,
  type CategoryRef,
  type CategoryWeight,
  type Page,
  todayIn,
  type WeighInAttemptDto,
  type WeighInCreate,
  type WeighInFailureOutcome,
  type WeighInOutcomeDto,
  type WeighInQuery,
  weighInResult,
  type WeighInRow,
  type WeighInSettingsDto,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import {
  AdmissionService,
  ENTRY_VIEW_SELECT,
  entryCursor,
  entrySearch,
  organizationOf,
  toAthleteBrief,
  toCategoryRef,
} from '../../admission';
import { AuditService } from '../../audit';
import { MERGEABLE } from '../../categories';
import { CHECK_IN_PHASE } from '../../checkin';
import { OutboxService } from '../../outbox';
import { RegistrationAccessService } from '../../registrations';
import { WriteLeaseService } from '../../venue-sync';
import { windowOpen } from '../domain/weighin-rules';
import { ATTEMPT_INCLUDE, limitsOf, toAttemptDto, toRecordDto, WeighInRecords } from './weighin-records';

/** Категории, где контрольное взвешивание ещё имеет смысл: до окончания соревнований в категории. */
const CONTROL_PHASE = ['WEIGH_IN', 'READY_FOR_DRAW', 'DRAWN', 'IN_PROGRESS'] as const;

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

const invalid = (path: string, code: string): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields: [{ path, code }] });

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const CATEGORY_SELECT = {
  id: true,
  code: true,
  nameRu: true,
  nameEn: true,
  status: true,
  gender: true,
  agePolicy: true,
  ageFrom: true,
  ageTo: true,
  birthYearFrom: true,
  birthYearTo: true,
  weightKind: true,
  weightLowerGrams: true,
  weightUpperGrams: true,
  sortOrder: true,
} satisfies Prisma.CompetitionCategorySelect;

type CategoryFacts = Prisma.CompetitionCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

const withWeight = (c: CategoryFacts): CategoryRef & { weight: CategoryWeight } => ({
  ...toCategoryRef(c),
  weight: limitsOf(c),
});

interface CompetitionFacts {
  id: string;
  status: string;
  timezone: string;
  outcome: WeighInFailureOutcome;
  toleranceGrams: number;
}

@Injectable()
export class WeighInService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly admission: AdmissionService,
    private readonly records: WeighInRecords,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Допуск по весу из закреплённой версии правил и исход по положению. */
  async competitionFacts(tx: Tx | null, competitionId: string): Promise<CompetitionFacts> {
    const c = await (tx ?? this.db).competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: {
        id: true,
        status: true,
        timezone: true,
        weighInFailureOutcome: true,
        ruleSetVersion: { select: { parameters: true } },
      },
    });
    const params = (c.ruleSetVersion?.parameters ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      status: c.status,
      timezone: c.timezone,
      outcome: c.weighInFailureOutcome,
      toleranceGrams: num(params.weighInToleranceGrams),
    };
  }

  async settings(competitionId: string): Promise<WeighInSettingsDto> {
    const c = await this.competitionFacts(null, competitionId);
    return { toleranceGrams: c.toleranceGrams, failureOutcome: c.outcome };
  }

  /** Запись попытки (API.md, 5.6): попытка append-only, итог и допуск пересчитываются в той же транзакции. */
  async record(user: AuthUser, entryId: string, req: WeighInCreate): Promise<WeighInOutcomeDto> {
    const ctx = await this.access.entryContext(entryId);
    const { viaPlatform } = await this.policy.assert(user, 'weighin.record', ctx.competitionScope);
    const competitionId = ctx.entry.competitionId;
    const now = new Date();
    const attemptId = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.competitionFacts(tx, competitionId);
      if (!CHECK_IN_PHASE.includes(competition.status as never)) throw blocked('competition_status');
      const entry = await this.lockEntry(tx, entryId);
      const category = await tx.competitionCategory.findUniqueOrThrow({
        where: { id: entry.categoryId },
        select: CATEGORY_SELECT,
      });
      await this.assertAttemptAllowed(tx, competition, entry, category, req, now);
      const id = await this.insertAttempt(tx, competition, entryId, category, req, user.id, now);
      const result = weighInResult(req.weightGrams, limitsOf(category), competition.toleranceGrams);
      await this.audit.record(tx, {
        action: 'weigh_in.recorded',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: ctx.application.organizationId,
        after: {
          attemptId: id,
          kind: req.kind,
          result,
          weightGrams: req.weightGrams,
          categoryId: category.id,
        },
        reason: req.note ?? null,
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'weighin.recorded',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: { entryId, attemptId: id, result },
      });
      await this.records.refresh(tx, competition, [entryId], now);
      await this.admission.recompute(tx, { id: entryId }, now);
      return id;
    });
    return this.outcome(user, entryId, attemptId);
  }

  /** Попытка со снимком границ категории и допуска (ARCHITECTURE.md, 14.3). */
  private async insertAttempt(
    tx: Tx,
    competition: CompetitionFacts,
    entryId: string,
    category: CategoryFacts,
    req: WeighInCreate,
    operatorId: string,
    now: Date,
  ): Promise<string> {
    const limits = limitsOf(category);
    const id = uuidv7();
    await tx.weighInAttempt.create({
      data: {
        id,
        competitionId: competition.id,
        entryId,
        categoryId: category.id,
        windowId: req.windowId,
        scaleId: req.scaleId,
        weightGrams: req.weightGrams,
        measuredAt: now,
        kind: req.kind,
        result: weighInResult(req.weightGrams, limits, competition.toleranceGrams),
        limitLowerGrams: limits.lowerGrams,
        limitUpperGrams: limits.kind === 'UP_TO' ? limits.upperGrams : null,
        toleranceGrams: competition.toleranceGrams,
        operatorId,
        note: req.note ?? null,
      },
    });
    return id;
  }

  private async lockEntry(
    tx: Tx,
    entryId: string,
  ): Promise<{ id: string; categoryId: string; athleteId: string }> {
    const [entry] = await tx.$queryRaw<
      { id: string; category_id: string; athlete_id: string; status: string }[]
    >`
      SELECT id, category_id, athlete_id, status FROM entry WHERE id = ${entryId}::uuid FOR UPDATE`;
    if (!entry) throw new DomainError('NOT_FOUND', { resource: 'entry' });
    if (entry.status !== 'APPROVED') throw blocked('entry_not_approved');
    return { id: entry.id, categoryId: entry.category_id, athleteId: entry.athlete_id };
  }

  /**
   * Условия попытки: окно этой категории открыто и допускает вид попытки; весы турнира с действующей поверкой;
   * спортсмен прибыл, если прибытие требует положение; вид попытки допустим при текущем итоге.
   */
  private async assertAttemptAllowed(
    tx: Tx,
    competition: CompetitionFacts,
    entry: { id: string; categoryId: string; athleteId: string },
    category: CategoryFacts,
    req: WeighInCreate,
    now: Date,
  ): Promise<void> {
    const window = await tx.weighInWindow.findFirst({
      where: { id: req.windowId, competitionId: competition.id },
      include: { categories: { where: { categoryId: category.id }, select: { id: true } } },
    });
    if (!window) throw invalid('windowId', 'not_found');
    if (window.categories.length === 0) throw invalid('windowId', 'category_not_in_window');
    if (!attemptKindsForWindow(window.kind).includes(req.kind)) throw invalid('kind', 'window_kind_mismatch');
    if (!windowOpen(window, now))
      throw new DomainError('WEIGH_IN_WINDOW_CLOSED', {
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
      });
    const scale = await tx.scale.findFirst({ where: { id: req.scaleId, competitionId: competition.id } });
    if (!scale) throw invalid('scaleId', 'not_found');
    const verifiedUntil = scale.verifiedUntil.toISOString().slice(0, 10);
    if (verifiedUntil < todayIn(competition.timezone, now))
      throw new DomainError('SCALE_CALIBRATION_EXPIRED', { verifiedUntil });
    const phase = req.kind === 'CONTROL' ? CONTROL_PHASE : (['WEIGH_IN'] as const);
    if (!(phase as readonly string[]).includes(category.status)) throw blocked('category_status');
    await this.assertArrived(tx, competition.id, entry);
    const current = (await this.records.refresh(tx, competition, [entry.id], now)).get(entry.id);
    const allowed = current ? toRecordDto(entry.id, current.status, null).allowedKinds : [];
    if (!allowed.includes(req.kind))
      throw new DomainError('INVALID_TRANSITION', {
        from: current?.status ?? 'EXPECTED',
        to: req.kind,
        allowed,
      });
  }

  /** NOT_CHECKED_IN (API.md, 5.6): взвешивают прибывших, если прибытие — требование положения для категории. */
  private async assertArrived(
    tx: Tx,
    competitionId: string,
    entry: { categoryId: string; athleteId: string },
  ): Promise<void> {
    const required = await tx.competitionRequirement.count({
      where: {
        competitionId,
        kind: 'CHECK_IN',
        mandatory: true,
        OR: [{ categoryId: null }, { categoryId: entry.categoryId }],
      },
    });
    if (required === 0) return;
    const checkIn = await tx.checkIn.findUnique({
      where: { competitionId_athleteId: { competitionId, athleteId: entry.athleteId } },
      select: { status: true },
    });
    if (checkIn?.status !== 'ARRIVED')
      throw new DomainError('NOT_CHECKED_IN', { status: checkIn?.status ?? 'EXPECTED' });
  }

  private async outcome(user: AuthUser, entryId: string, attemptId: string): Promise<WeighInOutcomeDto> {
    const attempt = await this.db.weighInAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: ATTEMPT_INCLUDE,
    });
    const record = await this.recordOf(entryId);
    const ctx = await this.access.entryContext(entryId);
    const admission = await this.admission.dtoOf(
      entryId,
      await this.policy.can(user, 'admission.override', ctx.competitionScope),
    );
    const result: WeighInOutcomeDto = { attempt: toAttemptDto(attempt), record, admission };
    const facts = await this.competitionFacts(null, attempt.competitionId);
    if (record.status === 'FAILED' && facts.outcome === 'TRANSFER')
      result.suggestedCategories = await this.suggestions(
        ctx.entry.categoryId,
        attempt.weightGrams,
        facts.toleranceGrams,
      );
    return result;
  }

  private async recordOf(entryId: string) {
    const r = await this.db.weighInRecord.findUnique({
      where: { entryId },
      include: { lastAttempt: { include: ATTEMPT_INCLUDE } },
    });
    return toRecordDto(entryId, r?.status ?? 'EXPECTED', r?.lastAttempt ?? null);
  }

  /**
   * Перевод по весу (D-06): действующие категории того же пола и возраста, куда вес проходит с допуском,
   * в которые ещё можно переводить (до жеребьёвки).
   */
  async suggestions(
    categoryId: string,
    weightGrams: number,
    toleranceGrams: number,
  ): Promise<(CategoryRef & { weight: CategoryWeight })[]> {
    const current = await this.db.competitionCategory.findUniqueOrThrow({
      where: { id: categoryId },
      select: { ...CATEGORY_SELECT, competitionId: true },
    });
    const candidates = await this.db.competitionCategory.findMany({
      where: {
        competitionId: current.competitionId,
        id: { not: categoryId },
        gender: current.gender,
        agePolicy: current.agePolicy,
        ageFrom: current.ageFrom,
        ageTo: current.ageTo,
        birthYearFrom: current.birthYearFrom,
        birthYearTo: current.birthYearTo,
        status: { in: [...MERGEABLE] },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: CATEGORY_SELECT,
    });
    return candidates
      .filter((c) => weighInResult(weightGrams, limitsOf(c), toleranceGrams) === 'PASSED')
      .map(withWeight);
  }

  /** Экран взвешивания (API.md, 5.6): одобренные участия категорий (окна), итог и последняя попытка. */
  async list(competitionId: string, q: WeighInQuery): Promise<Page<WeighInRow>> {
    const and: Prisma.EntryWhereInput[] = [{ competitionId, status: 'APPROVED' }];
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.windowId) and.push({ category: { weighInWindows: { some: { windowId: q.windowId } } } });
    if (q.status === 'EXPECTED')
      and.push({ OR: [{ weighInRecord: null }, { weighInRecord: { status: 'EXPECTED' } }] });
    else if (q.status) and.push({ weighInRecord: { status: q.status } });
    and.push(...entrySearch(q.q), ...entryCursor(decodeCursor(q.cursor)));
    const rows = await this.db.entry.findMany({
      where: { AND: and },
      orderBy: [{ snapLastName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      select: {
        ...ENTRY_VIEW_SELECT,
        category: { select: CATEGORY_SELECT },
        weighInRecord: { select: { status: true, lastAttempt: { include: ATTEMPT_INCLUDE } } },
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
      (r): WeighInRow => ({
        entryId: r.id,
        athlete: toAthleteBrief(r),
        organization: organizationOf(r),
        category: withWeight(r.category),
        declaredWeightGrams: r.declaredWeightGrams,
        checkIn: { status: arrival.get(r.athleteId) ?? 'EXPECTED' },
        record: toRecordDto(
          r.id,
          r.weighInRecord?.status ?? 'EXPECTED',
          r.weighInRecord?.lastAttempt ?? null,
        ),
      }),
    );
  }

  /** История попыток (API.md, 5.6): персонал с `weighin.view` и владелец заявки. */
  async history(user: AuthUser, entryId: string): Promise<WeighInAttemptDto[]> {
    const ctx = await this.access.entryContext(entryId);
    const staff = await this.policy.can(user, 'weighin.view', ctx.competitionScope);
    if (!staff && !(await this.access.isOwner(user, ctx.application.organizationId))) {
      await this.access.assertVisible(user, ctx);
      throw new DomainError('FORBIDDEN', { permission: 'weighin.view' });
    }
    const rows = await this.db.weighInAttempt.findMany({
      where: { entryId },
      orderBy: { measuredAt: 'asc' },
      include: ATTEMPT_INCLUDE,
    });
    return rows.map(toAttemptDto);
  }
}
