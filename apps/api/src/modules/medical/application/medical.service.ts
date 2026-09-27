// Медицинский допуск (API.md, 5.7; G-05, часть 1): только медицинский персонал турнира (`medical.view`,
// `medical.record`) и сам спортсмен или его представитель. Хранится факт допуска — срок и кто выдал, без
// диагнозов; каждый просмотр пишется в журнал доступа к медданным (раздел 37 ТЗ).
import { Injectable } from '@nestjs/common';
import {
  type MedicalClearanceCreate,
  type MedicalClearanceDto,
  type MedicalQuery,
  type MedicalRow,
  type MedicalState,
  type Page,
  todayIn,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AdmissionService } from '../../admission';
import { AthleteAccessService, AthleteExtensions } from '../../athletes';
import { AuditService, DataAccessLogService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';

type ClearanceRow = Prisma.MedicalClearanceGetPayload<object>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

export function toClearanceDto(c: ClearanceRow): MedicalClearanceDto {
  return {
    id: c.id,
    athleteId: c.athleteId,
    competitionId: c.competitionId,
    validUntil: dateOnly(c.validUntil),
    issuedBy: c.issuedBy,
    documentId: c.documentId,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    revokedAt: c.revokedAt?.toISOString() ?? null,
    revokeReason: c.revokeReason,
  };
}

/** Допуски, которые учитываются на турнире: общие и этого турнира. */
const relevant = (competitionId: string): Prisma.MedicalClearanceWhereInput => ({
  OR: [{ competitionId: null }, { competitionId }],
});

@Injectable()
export class MedicalService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly athletes: AthleteAccessService,
    private readonly athleteExtensions: AthleteExtensions,
    private readonly admission: AdmissionService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly accessLog: DataAccessLogService,
    private readonly outbox: OutboxService,
  ) {}

  /** Спортсмены турнира с одобренными участиями и их медицинский допуск на дату начала турнира. */
  async list(competitionId: string, q: MedicalQuery): Promise<Page<MedicalRow>> {
    const competition = await this.competitions.require(competitionId);
    const rows = await this.db.athleteProfile.findMany({
      where: { AND: listWhere(competitionId, competition.startDate, q) },
      orderBy: [{ person: { lastName: 'asc' } }, { id: 'asc' }],
      take: q.limit + 1,
      include: {
        person: { select: { lastName: true, firstName: true, middleName: true, birthDate: true } },
        clearances: { where: relevant(competitionId), orderBy: { createdAt: 'desc' } },
        entries: {
          where: { competitionId, status: 'APPROVED' },
          select: {
            publicName: true,
            application: { select: { organization: { select: { id: true, name: true, shortName: true } } } },
          },
        },
      },
    });
    await this.accessLog.record('VIEW', 'MedicalList', competitionId, competitionId);
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.person.lastName, id: r.id }),
      (r) => toMedicalRow(r, competition.startDate),
    );
  }

  private async assertAthleteInCompetition(tx: Tx, competitionId: string, athleteId: string): Promise<void> {
    const entry = await tx.entry.findFirst({
      where: { competitionId, athleteId, status: 'APPROVED' },
      select: { id: true },
    });
    if (!entry) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
  }

  /** Допуск врача турнира: действует на период или только на этот турнир; пересчёт допуска участий спортсмена. */
  async record(
    user: AuthUser,
    competitionId: string,
    input: MedicalClearanceCreate,
  ): Promise<MedicalClearanceDto> {
    const competition = await this.competitions.require(competitionId);
    if (input.validUntil < todayIn(competition.timezone))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'validUntil', code: 'in_past' }] });
    const id = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await this.assertAthleteInCompetition(tx, competitionId, input.athleteId);
      if (
        input.documentId &&
        !(await this.athleteExtensions.documentBelongs(tx, input.athleteId, input.documentId))
      )
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'documentId', code: 'not_found' }] });
      const clearance = await tx.medicalClearance.create({
        data: {
          id: uuidv7(),
          athleteId: input.athleteId,
          competitionId: input.competitionOnly ? competitionId : null,
          validUntil: new Date(`${input.validUntil}T00:00:00.000Z`),
          issuedBy: input.issuedBy,
          documentId: input.documentId ?? null,
          recordedById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'medical.clearance_recorded',
        entityType: 'MedicalClearance',
        entityId: clearance.id,
        competitionId,
        after: {
          athleteId: input.athleteId,
          validUntil: input.validUntil,
          competitionOnly: input.competitionOnly,
        },
      });
      await this.changed(tx, clearance.id, input.athleteId, 'VALID', competitionId);
      return clearance.id;
    });
    return toClearanceDto(await this.db.medicalClearance.findUniqueOrThrow({ where: { id } }));
  }

  async revoke(
    user: AuthUser,
    competitionId: string,
    clearanceId: string,
    reason: string,
  ): Promise<MedicalClearanceDto> {
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const c = await tx.medicalClearance.findFirst({
        where: { id: clearanceId, ...relevant(competitionId) },
      });
      if (!c) throw new DomainError('NOT_FOUND', { resource: 'medical_clearance' });
      await this.assertAthleteInCompetition(tx, competitionId, c.athleteId);
      if (c.status !== 'VALID')
        throw new DomainError('INVALID_TRANSITION', { from: c.status, to: 'REVOKED', allowed: [] });
      await tx.medicalClearance.update({
        where: { id: clearanceId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id, revokeReason: reason },
      });
      await this.audit.record(tx, {
        action: 'medical.clearance_revoked',
        entityType: 'MedicalClearance',
        entityId: clearanceId,
        competitionId,
        before: { status: 'VALID' },
        after: { status: 'REVOKED' },
        reason,
      });
      await this.changed(tx, clearanceId, c.athleteId, 'REVOKED', competitionId);
    });
    return toClearanceDto(await this.db.medicalClearance.findUniqueOrThrow({ where: { id: clearanceId } }));
  }

  private async changed(
    tx: Tx,
    clearanceId: string,
    athleteId: string,
    status: string,
    competitionId: string,
  ): Promise<void> {
    await this.outbox.enqueue(tx, {
      type: 'medical.clearance_changed',
      aggregate: { type: 'MedicalClearance', id: clearanceId },
      competitionId,
      payload: { clearanceId, athleteId, status },
    });
    await this.admission.recompute(tx, { athleteId });
  }

  /**
   * Допуски спортсмена (API.md, 5.7): сам спортсмен и подтверждённый представитель — все; врач турнира —
   * при `?competitionId=`, если спортсмен участвует в этом турнире.
   */
  async ofAthlete(user: AuthUser, athleteId: string, competitionId?: string): Promise<MedicalClearanceDto[]> {
    const rel = await this.athletes.relation(user, athleteId);
    const personal = rel.relation === 'SELF' || (rel.relation === 'GUARDIAN' && rel.verified);
    let staffIn: string | null = null;
    if (!personal && competitionId) {
      const scope = await this.competitions.scopeOf(competitionId);
      if (await this.policy.can(user, 'medical.view', scope)) {
        await this.assertAthleteInCompetition(this.db, competitionId, athleteId);
        staffIn = competitionId;
      }
    }
    if (!personal && !staffIn) {
      await this.accessLog.record('DENIED', 'MedicalClearance', athleteId, competitionId ?? null);
      throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    }
    const rows = await this.db.medicalClearance.findMany({
      where: { athleteId, ...(staffIn ? relevant(staffIn) : {}) },
      orderBy: { createdAt: 'desc' },
    });
    await this.accessLog.record('VIEW', 'MedicalClearance', athleteId, staffIn);
    return rows.map(toClearanceDto);
  }
}

function listWhere(
  competitionId: string,
  startDate: string,
  q: MedicalQuery,
): Prisma.AthleteProfileWhereInput[] {
  const valid: Prisma.AthleteProfileWhereInput = {
    clearances: {
      some: { status: 'VALID', validUntil: { gte: new Date(startDate) }, ...relevant(competitionId) },
    },
  };
  const revoked: Prisma.AthleteProfileWhereInput = {
    clearances: { some: { status: 'REVOKED', ...relevant(competitionId) } },
  };
  const and: Prisma.AthleteProfileWhereInput[] = [
    { entries: { some: { competitionId, status: 'APPROVED' } } },
  ];
  if (q.state === 'VALID') and.push(valid);
  if (q.state === 'REVOKED') and.push({ NOT: valid }, revoked);
  if (q.state === 'MISSING') and.push({ NOT: valid }, { NOT: revoked });
  if (q.q)
    and.push({
      person: {
        OR: [
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { firstName: { contains: q.q, mode: 'insensitive' } },
        ],
      },
    });
  const cursor = decodeCursor(q.cursor);
  if (cursor)
    and.push({
      OR: [
        { person: { lastName: { gt: cursor.k } } },
        { person: { lastName: cursor.k }, id: { gt: cursor.id } },
      ],
    });
  return and;
}

interface MedicalAthleteRow {
  id: string;
  person: { lastName: string; firstName: string; middleName: string | null; birthDate: Date };
  clearances: ClearanceRow[];
  entries: {
    publicName: string;
    application: { organization: { id: string; name: string; shortName: string } };
  }[];
}

/** Действующий допуск на дату начала турнира, иначе последний отозванный (состояние REVOKED). */
function toMedicalRow(r: MedicalAthleteRow, startDate: string): MedicalRow {
  const current =
    r.clearances.find((c) => c.status === 'VALID' && dateOnly(c.validUntil) >= startDate) ?? null;
  const latest = r.clearances[0] ?? null;
  const state: MedicalState = current ? 'VALID' : latest?.status === 'REVOKED' ? 'REVOKED' : 'MISSING';
  const shown = current ?? (state === 'REVOKED' ? latest : null);
  const orgs = new Map(r.entries.map((e) => [e.application.organization.id, e.application.organization]));
  return {
    athlete: {
      id: r.id,
      lastName: r.person.lastName,
      firstName: r.person.firstName,
      middleName: r.person.middleName,
      birthDate: dateOnly(r.person.birthDate),
      publicName: r.entries[0]?.publicName ?? r.person.lastName,
    },
    organizations: [...orgs.values()],
    state,
    clearance: shown ? toClearanceDto(shown) : null,
  };
}
