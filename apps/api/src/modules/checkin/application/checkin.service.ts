// Прибытие спортсменов (API.md, 5.5; раздел 15 ТЗ): список с поиском, счётчики, отметка, сканирование QR.
// Отметка — одна на спортсмена; допуск всех его участий пересчитывается в той же транзакции.
import { Inject, Injectable } from '@nestjs/common';
import type {
  CheckInDto,
  CheckInEntry,
  CheckInQuery,
  CheckInRow,
  CheckInStatus,
  CheckInSummaryDto,
  CheckInUpdate,
  Page,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { deriveKey, type Env, KEY_PURPOSES } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import {
  AdmissionService,
  ENTRY_VIEW_SELECT,
  type EntryView,
  organizationOf,
  toAthleteBrief,
  toCategoryRef,
} from '../../admission';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { CHECK_IN_PHASE, canCheckIn, checkInTransitions, verifyQrToken } from '../domain/checkin-rules';

type CheckInRecord = Prisma.CheckInGetPayload<object>;

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

@Injectable()
export class CheckInService {
  readonly qrKey: Buffer;

  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly admission: AdmissionService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ENV) env: Env,
  ) {
    this.qrKey = deriveKey(env.AUTH_SECRET, KEY_PURPOSES.qr);
  }

  /** Строки прибытия для спортсменов с одобренными участиями (начало мандатной комиссии, позднее одобрение). */
  async ensureRows(tx: Tx, competitionId: string, athleteIds?: string[]): Promise<void> {
    const entries = await tx.entry.findMany({
      where: { competitionId, status: 'APPROVED', ...(athleteIds ? { athleteId: { in: athleteIds } } : {}) },
      distinct: ['athleteId'],
      select: { athleteId: true },
    });
    if (entries.length === 0) return;
    await tx.checkIn.createMany({
      data: entries.map((e) => ({ id: uuidv7(), competitionId, athleteId: e.athleteId })),
      skipDuplicates: true,
    });
  }

  private async actionsFor(user: AuthUser, competitionId: string) {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    const can =
      CHECK_IN_PHASE.includes(competition.status) && (await this.policy.can(user, 'checkin.perform', scope));
    return (status: CheckInStatus): string[] =>
      can ? checkInTransitions(status).map((to) => `set:${to}`) : [];
  }

  private async rows(
    competitionId: string,
    records: { athleteId: string; record: CheckInRecord | null }[],
    actions: (status: CheckInStatus) => string[],
  ): Promise<CheckInRow[]> {
    const athleteIds = records.map((r) => r.athleteId);
    const entries = await this.db.entry.findMany({
      where: { competitionId, status: 'APPROVED', athleteId: { in: athleteIds } },
      orderBy: { createdAt: 'asc' },
      select: ENTRY_VIEW_SELECT,
    });
    const summaries = await this.admission.summaries(entries.map((e) => e.id));
    const byAthlete = new Map<string, EntryView[]>();
    for (const e of entries) byAthlete.set(e.athleteId, [...(byAthlete.get(e.athleteId) ?? []), e]);
    return records.flatMap(({ athleteId, record }) => {
      const own = byAthlete.get(athleteId) ?? [];
      const first = own[0];
      if (!first) return [];
      const list: CheckInEntry[] = own.map((e) => ({
        id: e.id,
        category: toCategoryRef(e.category),
        organization: organizationOf(e),
        admission: summaries.get(e.id) ?? { status: 'PENDING', failed: [], pending: [] },
      }));
      return [
        { athlete: toAthleteBrief(first), entries: list, checkIn: toCheckInDto(athleteId, record, actions) },
      ];
    });
  }

  async list(user: AuthUser, competitionId: string, q: CheckInQuery): Promise<Page<CheckInRow>> {
    const and: Prisma.CheckInWhereInput[] = [
      { competitionId, athlete: { entries: { some: { competitionId, status: 'APPROVED' } } } },
    ];
    if (q.status) and.push({ status: q.status });
    if (q.organizationId)
      and.push({
        athlete: {
          entries: {
            some: { competitionId, status: 'APPROVED', application: { organizationId: q.organizationId } },
          },
        },
      });
    if (q.q)
      and.push({
        athlete: {
          person: {
            OR: [
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { firstName: { contains: q.q, mode: 'insensitive' } },
            ],
          },
        },
      });
    const cursor = decodeCursor(q.cursor);
    if (cursor)
      and.push({
        OR: [
          { athlete: { person: { lastName: { gt: cursor.k } } } },
          { athlete: { person: { lastName: cursor.k } }, id: { gt: cursor.id } },
        ],
      });
    const records = await this.db.checkIn.findMany({
      where: { AND: and },
      orderBy: [{ athlete: { person: { lastName: 'asc' } } }, { id: 'asc' }],
      take: q.limit + 1,
      include: { athlete: { select: { person: { select: { lastName: true } } } } },
    });
    const page = toPage(
      records,
      q.limit,
      (r) => ({ k: r.athlete.person.lastName, id: r.id }),
      (r) => r,
    );
    const actions = await this.actionsFor(user, competitionId);
    const data = await this.rows(
      competitionId,
      page.data.map((r) => ({ athleteId: r.athleteId, record: r })),
      actions,
    );
    return { data, page: page.page };
  }

  /** Строка одного спортсмена; нет одобренных участий в турнире — 404. */
  async row(user: AuthUser, competitionId: string, athleteId: string): Promise<CheckInRow> {
    const record = await this.db.checkIn.findUnique({
      where: { competitionId_athleteId: { competitionId, athleteId } },
    });
    const [row] = await this.rows(
      competitionId,
      [{ athleteId, record }],
      await this.actionsFor(user, competitionId),
    );
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    return row;
  }

  /** Счётчики раздела 15 ТЗ — по спортсменам. */
  async summary(competitionId: string): Promise<CheckInSummaryDto> {
    const [entries] = await this.db.$queryRaw<{ declared: bigint; approved: bigint }[]>`
      SELECT
        count(DISTINCT e.athlete_id) FILTER (WHERE e.status IN ('PENDING', 'APPROVED') AND a.status <> 'DRAFT') AS declared,
        count(DISTINCT e.athlete_id) FILTER (WHERE e.status = 'APPROVED') AS approved
      FROM entry e JOIN application a ON a.id = e.application_id
      WHERE e.competition_id = ${competitionId}::uuid`;
    const statuses = await this.db.$queryRaw<{ status: CheckInStatus; n: bigint }[]>`
      SELECT c.status, count(*) AS n FROM check_in c
      WHERE c.competition_id = ${competitionId}::uuid
        AND EXISTS (SELECT 1 FROM entry e WHERE e.competition_id = c.competition_id
                    AND e.athlete_id = c.athlete_id AND e.status = 'APPROVED')
      GROUP BY c.status`;
    const [problems] = await this.db.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT e.athlete_id) AS n
      FROM entry e
      JOIN admission ad ON ad.entry_id = e.id
      JOIN admission_check ac ON ac.admission_id = ad.id
      WHERE e.competition_id = ${competitionId}::uuid AND e.status = 'APPROVED'
        AND ac.kind IN ('DOCUMENTS', 'INSURANCE') AND ac.status IN ('PENDING', 'FAILED')`;
    const by = (s: CheckInStatus): number => Number(statuses.find((x) => x.status === s)?.n ?? 0);
    const approved = Number(entries?.approved ?? 0);
    return {
      declared: Number(entries?.declared ?? 0),
      approved,
      expected: Math.max(0, approved - by('ARRIVED') - by('NOT_ARRIVED') - by('WITHDRAWN')),
      arrived: by('ARRIVED'),
      notArrived: by('NOT_ARRIVED'),
      withdrawn: by('WITHDRAWN'),
      problemDocuments: Number(problems?.n ?? 0),
    };
  }

  /** Сканирование QR (API.md, 5.5): карточка спортсмена без смены статуса. Чужой или поддельный токен — 404. */
  async scan(user: AuthUser, competitionId: string, qrToken: string): Promise<CheckInRow> {
    const claims = verifyQrToken(this.qrKey, qrToken, new Date());
    if (!claims || claims.competitionId !== competitionId)
      throw new DomainError('NOT_FOUND', { resource: 'qr' });
    return this.row(user, competitionId, claims.athleteId);
  }

  /** Отметка прибытия (API.md, 5.5): If-Match, переходы ARCHITECTURE.md, 16.4, пересчёт допуска. */
  async update(
    user: AuthUser,
    competitionId: string,
    athleteId: string,
    version: number,
    req: CheckInUpdate,
  ): Promise<CheckInRow> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'checkin.perform', scope);
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const competition = await tx.competition.findUniqueOrThrow({
        where: { id: competitionId },
        select: { status: true },
      });
      if (!CHECK_IN_PHASE.includes(competition.status)) throw blocked('competition_status');
      await this.ensureRows(tx, competitionId, [athleteId]);
      const [row] = await tx.$queryRaw<{ id: string; status: CheckInStatus; version: number }[]>`
        SELECT id, status, version FROM check_in
        WHERE competition_id = ${competitionId}::uuid AND athlete_id = ${athleteId}::uuid FOR UPDATE`;
      if (!row) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
      if (row.version !== version) throw versionConflict(row.version);
      if (!canCheckIn(row.status, req.status))
        throw new DomainError('INVALID_TRANSITION', {
          from: row.status,
          to: req.status,
          allowed: checkInTransitions(row.status),
        });
      await this.apply(tx, { ...row, competitionId, athleteId }, req, user.id, viaPlatform);
    });
    return this.row(user, competitionId, athleteId);
  }

  private async apply(
    tx: Tx,
    row: { id: string; status: CheckInStatus; competitionId: string; athleteId: string },
    req: CheckInUpdate,
    userId: string,
    viaPlatform: boolean,
  ): Promise<void> {
    await tx.checkIn.update({
      where: { id: row.id },
      data: {
        status: req.status,
        method: req.method,
        arrivedAt: req.status === 'ARRIVED' ? new Date() : undefined,
        operatorId: userId,
        note: req.note ?? null,
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'checkin.updated',
      entityType: 'CheckIn',
      entityId: row.id,
      competitionId: row.competitionId,
      before: { status: row.status },
      after: { status: req.status, method: req.method },
      reason: req.note ?? null,
      platformIntervention: viaPlatform,
    });
    await this.outbox.enqueue(tx, {
      type: 'checkin.updated',
      aggregate: { type: 'CheckIn', id: row.id },
      competitionId: row.competitionId,
      payload: { athleteId: row.athleteId, status: req.status },
    });
    await this.admission.recompute(tx, { competitionId: row.competitionId, athleteId: row.athleteId });
  }
}

function toCheckInDto(
  athleteId: string,
  r: CheckInRecord | null,
  actions: (status: CheckInStatus) => string[],
): CheckInDto {
  const status = r?.status ?? 'EXPECTED';
  return {
    athleteId,
    status,
    method: r?.method ?? null,
    arrivedAt: r?.arrivedAt?.toISOString() ?? null,
    note: r?.note ?? null,
    version: r?.version ?? 1,
    updatedAt: (r?.updatedAt ?? new Date(0)).toISOString(),
    allowedActions: actions(status),
  };
}
