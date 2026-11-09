// Быстрое взвешивание (правки 09.11.2026, п. 3): спортсмен показывает QR из личного кабинета, у оператора открывается
// карточка (ФИО, дата рождения, документы, заявленная категория), спортсмен встаёт на весы, оператор нажимает «Норма»,
// «Недовес» или «Перевес». При недовесе и перевесе оператор решает: снять спортсмена или перевести в соседнюю весовую
// категорию (ниже или выше). Окно и весы настраивать не нужно, вес вводить не обязательно — решение оператора
// записывается попыткой взвешивания, прибытие отмечается тем же действием.
import { Injectable } from '@nestjs/common';
import {
  type CategoryRef,
  type CategoryWeight,
  isReadinessBlocking,
  type WeighInAttemptKind,
  type WeighInCardDto,
  type WeighInDecision,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AdmissionService, toCategoryRef } from '../../admission';
import { AuditService } from '../../audit';
import { MERGEABLE } from '../../categories';
import { CHECK_IN_PHASE, CheckInService } from '../../checkin';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import {
  EntryDecisionsService,
  EntryWithdrawalService,
  readinessOf,
  RegistrationAccessService,
} from '../../registrations';
import { WriteLeaseService } from '../../venue-sync';
import { limitsOf, WeighInRecords } from './weighin-records';
import { WeighInService } from './weighin.service';

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

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
  competitionId: true,
} satisfies Prisma.CompetitionCategorySelect;

type CategoryFacts = Prisma.CompetitionCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

const withWeight = (c: CategoryFacts): CategoryRef & { weight: CategoryWeight } => ({
  ...toCategoryRef(c),
  weight: limitsOf(c),
});

/** Верхняя граница веса для упорядочивания: «свыше» — самая тяжёлая. */
const ceiling = (c: CategoryFacts): number =>
  c.weightKind === 'UP_TO' && c.weightUpperGrams !== null ? c.weightUpperGrams : Number.MAX_SAFE_INTEGER;

const VERDICT_NOTE = {
  NORMAL: 'Взвешивание: вес в норме',
  UNDER: 'Взвешивание: недовес',
  OVER: 'Взвешивание: перевес',
} as const;

@Injectable()
export class WeighInQuickService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: RegistrationAccessService,
    private readonly competitions: CompetitionScopeService,
    private readonly admission: AdmissionService,
    private readonly records: WeighInRecords,
    private readonly weighins: WeighInService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly checkins: CheckInService,
    private readonly withdrawals: EntryWithdrawalService,
    private readonly decisions: EntryDecisionsService,
  ) {}

  /** Соседние весовые категории той же возрастной группы и пола, куда ещё можно переводить. */
  private async neighbours(
    category: CategoryFacts,
  ): Promise<{ lighter: CategoryFacts | null; heavier: CategoryFacts | null }> {
    const same = await this.db.competitionCategory.findMany({
      where: {
        competitionId: category.competitionId,
        id: { not: category.id },
        gender: category.gender,
        agePolicy: category.agePolicy,
        ageFrom: category.ageFrom,
        ageTo: category.ageTo,
        birthYearFrom: category.birthYearFrom,
        birthYearTo: category.birthYearTo,
        status: { in: [...MERGEABLE] },
      },
      select: CATEGORY_SELECT,
    });
    const own = ceiling(category);
    const lighter = same.filter((c) => ceiling(c) < own).sort((a, b) => ceiling(b) - ceiling(a))[0] ?? null;
    const heavier = same.filter((c) => ceiling(c) > own).sort((a, b) => ceiling(a) - ceiling(b))[0] ?? null;
    return { lighter, heavier };
  }

  private async cardOf(entryId: string): Promise<WeighInCardDto> {
    const e = await this.db.entry.findUniqueOrThrow({
      where: { id: entryId },
      select: {
        id: true,
        version: true,
        athleteId: true,
        competitionId: true,
        snapLastName: true,
        snapFirstName: true,
        snapMiddleName: true,
        snapBirthDate: true,
        snapClubName: true,
        application: { select: { organization: { select: { id: true, name: true, shortName: true } } } },
        category: { select: CATEGORY_SELECT },
        weighInRecord: { select: { status: true } },
      },
    });
    const competition = await this.competitions.require(e.competitionId);
    const [readiness, checkIn, near] = await Promise.all([
      readinessOf(this.db, { id: competition.id, startDate: competition.startDate }, [e.athleteId]),
      this.db.checkIn.findUnique({
        where: { competitionId_athleteId: { competitionId: e.competitionId, athleteId: e.athleteId } },
        select: { status: true },
      }),
      this.neighbours(e.category),
    ]);
    const docs = readiness.get(e.athleteId);
    return {
      entryId: e.id,
      entryVersion: e.version,
      athleteId: e.athleteId,
      lastName: e.snapLastName,
      firstName: e.snapFirstName,
      middleName: e.snapMiddleName,
      birthDate: e.snapBirthDate.toISOString().slice(0, 10),
      organization: e.application.organization,
      category: withWeight(e.category),
      lighter: near.lighter ? withWeight(near.lighter) : null,
      heavier: near.heavier ? withWeight(near.heavier) : null,
      documentsOk: !!docs && !isReadinessBlocking(docs.state),
      weighIn: e.weighInRecord?.status ?? 'EXPECTED',
      checkIn: checkIn?.status ?? 'EXPECTED',
    };
  }

  /** Карточки по QR спортсмена: его одобренные участия в турнире (обычно одно). */
  async cards(user: AuthUser, competitionId: string, qrToken: string): Promise<WeighInCardDto[]> {
    await this.policy.assert(user, 'weighin.view', await this.competitions.scopeOf(competitionId));
    const athleteId = this.checkins.athleteByQr(competitionId, qrToken);
    if (!athleteId) throw new DomainError('NOT_FOUND', { resource: 'qr' });
    const entries = await this.db.entry.findMany({
      where: { competitionId, athleteId, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const out: WeighInCardDto[] = [];
    for (const x of entries) out.push(await this.cardOf(x.id));
    return out;
  }

  /** Карточка одного участия (после решения или из списка). */
  async card(user: AuthUser, entryId: string): Promise<WeighInCardDto> {
    const ctx = await this.access.entryContext(entryId);
    await this.policy.assert(user, 'weighin.view', ctx.competitionScope);
    return this.cardOf(entryId);
  }

  async decide(user: AuthUser, entryId: string, req: WeighInDecision): Promise<WeighInCardDto> {
    const ctx = await this.access.entryContext(entryId);
    const { viaPlatform } = await this.policy.assert(user, 'weighin.record', ctx.competitionScope);
    const competitionId = ctx.entry.competitionId;
    const transfer = req.verdict !== 'NORMAL' && req.action === 'TRANSFER';
    let target: CategoryFacts | null = null;
    if (transfer) {
      const current = await this.db.competitionCategory.findUniqueOrThrow({
        where: { id: ctx.entry.categoryId },
        select: CATEGORY_SELECT,
      });
      if (req.toCategoryId) {
        target = await this.db.competitionCategory.findFirst({
          where: { id: req.toCategoryId, competitionId },
          select: CATEGORY_SELECT,
        });
      } else {
        const near = await this.neighbours(current);
        target = req.verdict === 'UNDER' ? near.lighter : near.heavier;
      }
      if (!target)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'toCategoryId', code: 'no_neighbour_category' }],
        });
    }
    const now = new Date();
    // 1. Прибытие, решение по весу в заявленной категории; «не участвует» — снятие с турнира.
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const competition = await this.weighins.competitionFacts(tx, competitionId);
      if (!CHECK_IN_PHASE.includes(competition.status as never)) throw blocked('competition_status');
      const entry = await this.lockApproved(tx, entryId);
      await this.checkins.arriveInTx(tx, competitionId, entry.athleteId, user.id, viaPlatform);
      await this.insertDecision(tx, competition, entry, req.verdict === 'NORMAL', req, user.id, now);
      await this.audit.record(tx, {
        action: 'weigh_in.recorded',
        entityType: 'Entry',
        entityId: entryId,
        competitionId,
        organizationId: ctx.application.organizationId,
        after: {
          verdict: req.verdict,
          action: req.action ?? null,
          weightGrams: req.weightGrams ?? null,
          categoryId: entry.categoryId,
          toCategoryId: target?.id ?? null,
        },
        reason: VERDICT_NOTE[req.verdict],
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'weighin.recorded',
        aggregate: { type: 'Entry', id: entryId },
        competitionId,
        payload: {
          entryId,
          attemptId: entry.attemptId as string,
          result: req.verdict === 'NORMAL' ? 'PASSED' : 'FAILED',
        },
      });
      if (req.verdict !== 'NORMAL' && req.action === 'WITHDRAW')
        await this.withdrawals.withdrawBySystem(
          tx,
          entryId,
          user.id,
          `${VERDICT_NOTE[req.verdict]}, не участвует`,
          'weigh_in_failed',
        );
      await this.records.refresh(tx, competition, [entryId], now);
      await this.admission.recompute(tx, { id: entryId }, now);
    });
    // 2. Перевод в соседнюю категорию и взвешивание в ней «в норме».
    if (transfer && target) {
      const fresh = await this.db.entry.findUniqueOrThrow({
        where: { id: entryId },
        select: { version: true },
      });
      await this.decisions.transfer(user, entryId, fresh.version, {
        toCategoryId: target.id,
        reason: `${VERDICT_NOTE[req.verdict]}, перевод в другую весовую категорию`,
      });
      await this.db.tx(async (tx) => {
        const competition = await this.weighins.competitionFacts(tx, competitionId);
        const entry = await this.lockApproved(tx, entryId);
        await this.insertDecision(
          tx,
          competition,
          entry,
          true,
          { ...req, verdict: 'NORMAL' },
          user.id,
          new Date(),
        );
        await this.records.refresh(tx, competition, [entryId], new Date());
        await this.admission.recompute(tx, { id: entryId }, new Date());
      });
    }
    return this.cardOf(entryId);
  }

  private async lockApproved(
    tx: Tx,
    entryId: string,
  ): Promise<{ id: string; categoryId: string; athleteId: string; attemptId?: string }> {
    const [entry] = await tx.$queryRaw<
      { id: string; category_id: string; athlete_id: string; status: string }[]
    >`
      SELECT id, category_id, athlete_id, status FROM entry WHERE id = ${entryId}::uuid FOR UPDATE`;
    if (!entry) throw new DomainError('NOT_FOUND', { resource: 'entry' });
    if (entry.status !== 'APPROVED') throw blocked('entry_not_approved');
    return { id: entry.id, categoryId: entry.category_id, athleteId: entry.athlete_id };
  }

  /**
   * Попытка-решение: первая — официальная, следующие — повторные (последняя решает итог). Границы категории —
   * снимком, как у обычной попытки.
   */
  private async insertDecision(
    tx: Tx,
    competition: { id: string; toleranceGrams: number },
    entry: { id: string; categoryId: string; attemptId?: string },
    passed: boolean,
    req: WeighInDecision,
    operatorId: string,
    now: Date,
  ): Promise<void> {
    const category = await tx.competitionCategory.findUniqueOrThrow({
      where: { id: entry.categoryId },
      select: CATEGORY_SELECT,
    });
    const previous = await tx.weighInAttempt.count({
      where: { entryId: entry.id, kind: { not: 'CONTROL' } },
    });
    const kind: WeighInAttemptKind = previous === 0 ? 'OFFICIAL' : 'RECHECK';
    const limits = limitsOf(category);
    const id = uuidv7();
    await tx.weighInAttempt.create({
      data: {
        id,
        competitionId: competition.id,
        entryId: entry.id,
        categoryId: category.id,
        windowId: null,
        scaleId: null,
        weightGrams: req.weightGrams ?? null,
        measuredAt: now,
        kind,
        result: passed ? 'PASSED' : 'FAILED',
        limitLowerGrams: limits.lowerGrams,
        limitUpperGrams: limits.kind === 'UP_TO' ? limits.upperGrams : null,
        toleranceGrams: competition.toleranceGrams,
        operatorId,
        note: VERDICT_NOTE[req.verdict],
      },
    });
    entry.attemptId = id;
  }
}
