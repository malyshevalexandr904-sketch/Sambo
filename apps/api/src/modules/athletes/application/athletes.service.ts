// Спортсмены (API.md, 4.1): список по видимости, проверка дублей, создание, карточка, изменение, архив.
import { Injectable } from '@nestjs/common';
import {
  type Athlete,
  type AthleteCreate,
  type AthletePatch,
  type AthletesQuery,
  type AthleteSummary,
  type DuplicateCandidate,
  type Page,
  type PermissionCode,
  type PersonInput,
  publicName,
} from '@sde/contracts';
import { type Prisma, publicId, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import { OrganizationScopeService } from '../../organizations';
import { PeopleService, personAudit } from '../../people';
import { checkStatusChange, dateOnly, electronicConsentDecision, todayIso } from '../domain/athlete-rules';
import { AthleteAccessService, currentPeriod, type RelationInfo } from './athlete-access.service';
import { AthleteExtensions } from './athlete-extensions';
import {
  coachLinkDto,
  detailInclude,
  type DetailRow,
  guardianDto,
  membershipDto,
  personDto,
  summaryInclude,
  toSummary,
} from './athlete-mapper';

const ACTION_CANDIDATES: readonly PermissionCode[] = [
  'athlete.update',
  'athlete.archive',
  'guardian.manage',
  'consent.record',
  'document.upload',
  'document.view',
];

const CLUB_TYPES = new Set(['CLUB', 'SPORTS_SCHOOL']);
const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

export interface CreateOptions {
  /** Кандидаты-дубли, которые пользователь видел и подтвердил, что это другие люди. */
  confirmedCandidateIds: string[] | null;
  confirmReason: string | null;
}

@Injectable()
export class AthletesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: AthleteAccessService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly coaches: CoachesService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
    private readonly extensions: AthleteExtensions,
  ) {}

  /** Организации, спортсменов которых видит пользователь (`athlete.view`), или 'all' для платформы. */
  async visibleOrganizations(user: AuthUser): Promise<string[] | 'all'> {
    const reach = await this.policy.reach(user, 'athlete.view');
    if (reach.platform) return 'all';
    const direct = reach.organizations.map((o) => o.organizationId);
    const roots = reach.organizations.filter((o) => o.withDescendants).map((o) => o.organizationId);
    const descendants =
      roots.length > 0
        ? (
            await this.db.organizationClosure.findMany({
              where: { ancestorId: { in: roots } },
              select: { descendantId: true },
            })
          ).map((r) => r.descendantId)
        : [];
    return [...new Set([...direct, ...descendants])];
  }

  /** Список фильтруется в SQL тем же набором областей, что и права (PERMISSIONS.md, 6). */
  async list(user: AuthUser, q: AthletesQuery): Promise<Page<AthleteSummary>> {
    const visible = await this.visibleOrganizations(user);
    if (q.organizationId && visible !== 'all' && !visible.includes(q.organizationId))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const orgs = q.organizationId ? [q.organizationId] : visible;
    if (orgs !== 'all' && orgs.length === 0) return { data: [], page: { nextCursor: null, hasMore: false } };
    const and: Prisma.AthleteProfileWhereInput[] = [];
    if (orgs !== 'all')
      and.push({ memberships: { some: { organizationId: { in: orgs }, ...currentPeriod() } } });
    if (q.coachId) and.push({ coaches: { some: { coachId: q.coachId, ...currentPeriod() } } });
    if (q.mine) {
      const coachId = await this.coaches.coachIdOfUser(user);
      if (!coachId) return { data: [], page: { nextCursor: null, hasMore: false } };
      and.push({ coaches: { some: { coachId, ...currentPeriod() } } });
    }
    if (q.q) {
      const needle = q.q.toLowerCase().replaceAll('ё', 'е');
      const ids = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM person
        WHERE last_name_norm LIKE ${needle + '%'} OR first_name_norm LIKE ${needle + '%'}
           OR (last_name_norm || ' ' || first_name_norm) LIKE ${needle + '%'}
        LIMIT 2000`;
      and.push({ personId: { in: ids.map((r) => r.id) } });
    }
    if (q.birthYear) {
      and.push({
        person: { birthDate: { gte: toDate(`${q.birthYear}-01-01`), lte: toDate(`${q.birthYear}-12-31`) } },
      });
    }
    if (q.gender) and.push({ person: { gender: q.gender } });
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      and.push({
        OR: [
          { person: { lastName: { gt: cursor.k } } },
          { person: { lastName: cursor.k }, id: { gt: cursor.id } },
        ],
      });
    }
    const rows = await this.db.athleteProfile.findMany({
      where: { status: q.status ?? { not: 'ARCHIVED' }, AND: and },
      orderBy: [{ person: { lastName: 'asc' } }, { id: 'asc' }],
      take: q.limit + 1,
      include: summaryInclude(),
    });
    return toPage(rows, q.limit, (r) => ({ k: r.person.lastName, id: r.id }), toSummary);
  }

  async duplicatesCheck(user: AuthUser, person: PersonInput): Promise<DuplicateCandidate[]> {
    if (!(await this.policy.holdsAnywhere(user, 'athlete.create')))
      throw new DomainError('FORBIDDEN', { permission: 'athlete.create' });
    return this.people.athleteDuplicates(this.db, person);
  }

  /** Организация спортсмена: видна, активна, это клуб или спортшкола, и у пользователя есть право. */
  async assertTargetOrganization(
    user: AuthUser,
    organizationId: string,
    permission: PermissionCode,
  ): Promise<void> {
    const scope = await this.orgScopes.scopeOf(organizationId);
    if (!(await this.policy.isVisible(user, scope)))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.status !== 'ACTIVE') throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId });
    if (!CLUB_TYPES.has(org.type))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'organizationId', code: 'not_a_club' }],
      });
    await this.policy.assert(user, permission, scope);
  }

  async create(user: AuthUser, input: AthleteCreate): Promise<Athlete> {
    await this.assertTargetOrganization(user, input.organizationId, 'athlete.create');
    const id = await this.db.tx((tx) =>
      this.createInTx(tx, user, input, {
        confirmedCandidateIds: input.confirmNotDuplicate?.candidateIds ?? null,
        confirmReason: input.confirmNotDuplicate?.reason ?? null,
      }),
    );
    return this.get(user, id);
  }

  /** Тренер клуба, создающий спортсмена без указания тренера, становится его основным тренером. */
  private async defaultCoach(tx: Tx, user: AuthUser, organizationId: string): Promise<string | null> {
    const grants = await this.policy.grants(user);
    const isCoach = grants.organizations.some(
      (g) => g.organizationId === organizationId && g.roles.includes('COACH'),
    );
    if (!isCoach) return null;
    const coachId = await this.coaches.ensureForUser(tx, user.id, organizationId);
    if (!coachId)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'coachId', code: 'coach_profile_required' }],
      });
    return coachId;
  }

  /**
   * Создание в транзакции (используется и импортом). Похожие спортсмены → POSSIBLE_DUPLICATE с кандидатами,
   * пока пользователь не подтвердит каждого кандидата с причиной (G-08).
   */
  async createInTx(tx: Tx, user: AuthUser, input: AthleteCreate, opts: CreateOptions): Promise<string> {
    const candidates = await this.people.athleteDuplicates(tx, input.person);
    const unconfirmed = candidates.filter((c) => !(opts.confirmedCandidateIds ?? []).includes(c.athleteId));
    if (unconfirmed.length > 0) throw new DomainError('POSSIBLE_DUPLICATE', { candidates });
    if (input.rank && !(await tx.sportRank.findUnique({ where: { code: input.rank.sportRankCode } })))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'rank.sportRankCode', code: 'invalid_code' }],
      });
    let coachId = input.coachId ?? null;
    if (coachId && !(await this.coaches.worksIn(tx, coachId, [input.organizationId])))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'coachId', code: 'coach_not_in_club' }],
      });
    coachId ??= await this.defaultCoach(tx, user, input.organizationId);

    const { person, athleteId } = await this.insertAthlete(tx, user, input, coachId);
    await this.audit.record(tx, {
      action: 'athlete.created',
      entityType: 'AthleteProfile',
      entityId: athleteId,
      organizationId: input.organizationId,
      after: {
        ...personAudit(person),
        organizationId: input.organizationId,
        coachId,
        sportRankCode: input.rank?.sportRankCode ?? null,
        confirmedNotDuplicateOf: candidates.map((c) => c.athleteId),
      },
      reason: candidates.length > 0 ? opts.confirmReason : null,
    });
    return athleteId;
  }

  private async insertAthlete(
    tx: Tx,
    user: AuthUser,
    input: AthleteCreate,
    coachId: string | null,
  ): Promise<{ person: Awaited<ReturnType<PeopleService['create']>>; athleteId: string }> {
    const person = await this.people.create(tx, input.person, user.id);
    const athleteId = uuidv7();
    await tx.athleteProfile.create({
      data: { id: athleteId, personId: person.id, publicId: publicId(), createdById: user.id },
    });
    const today = toDate(todayIso());
    await tx.athleteMembership.create({
      data: {
        id: uuidv7(),
        athleteId,
        organizationId: input.organizationId,
        isPrimary: true,
        validFrom: today,
        createdById: user.id,
      },
    });
    if (coachId) {
      await tx.athleteCoach.create({
        data: { id: uuidv7(), athleteId, coachId, isPrimary: true, validFrom: today, createdById: user.id },
      });
    }
    if (input.rank) {
      await tx.athleteRankRecord.create({
        data: {
          id: uuidv7(),
          athleteId,
          sportRankCode: input.rank.sportRankCode,
          assignedAt: toDate(input.rank.assignedAt),
          orderRef: input.rank.orderRef ?? null,
          createdById: user.id,
        },
      });
    }
    return { person, athleteId };
  }

  private async actions(
    user: AuthUser,
    row: DetailRow,
    relation: RelationInfo,
    scopes: Awaited<ReturnType<AthleteAccessService['scopesOf']>>,
  ): Promise<string[]> {
    const actions: string[] = await this.policy.allowedActionsAny(user, scopes, ACTION_CANDIDATES, {
      athleteId: row.id,
    });
    if (await this.policy.can(user, 'athlete.merge', { kind: 'PLATFORM' })) actions.push('athlete.merge');
    const actor =
      relation.relation === 'SELF'
        ? ({ relation: 'SELF' } as const)
        : relation.relation === 'GUARDIAN'
          ? ({ relation: 'GUARDIAN', verified: relation.verified } as const)
          : null;
    if (electronicConsentDecision(actor, dateOnly(row.person.birthDate), todayIso()) === 'ALLOWED') {
      actions.push('consent.give', 'consent.revoke');
      for (const a of ['document.upload', 'document.view']) if (!actions.includes(a)) actions.push(a);
    }
    return actions;
  }

  async get(user: AuthUser, id: string): Promise<Athlete> {
    const { scopes, relation } = await this.access.assertView(user, id);
    const row = await this.db.athleteProfile.findUniqueOrThrow({ where: { id }, include: detailInclude() });
    const today = todayIso();
    const memberships = row.memberships.map((m) => membershipDto(m, today));
    const coaches = row.coaches.map((c) => coachLinkDto(c, today));
    const rank = row.ranks[0];
    const status = await this.extensions.consentsStatusOf([row.personId]);
    return {
      id: row.id,
      publicId: row.publicId,
      person: personDto(row.person),
      status: row.status,
      currentClub:
        (memberships.find((m) => m.active && m.isPrimary) ?? memberships.find((m) => m.active))
          ?.organization ?? null,
      currentCoach:
        (coaches.find((c) => c.active && c.isPrimary) ?? coaches.find((c) => c.active))?.coach ?? null,
      currentRank: rank
        ? {
            code: rank.sportRankCode,
            name: { ru: rank.sportRank.nameRu, en: rank.sportRank.nameEn },
            assignedAt: dateOnly(rank.assignedAt),
          }
        : null,
      memberships,
      coaches,
      guardians: row.guardians.map(guardianDto),
      consentsStatus: status.get(row.personId) as Athlete['consentsStatus'],
      relation: relation.relation === 'GUARDIAN' && !relation.verified ? null : relation.relation,
      version: row.version,
      allowedActions: await this.actions(user, row, relation, scopes),
    };
  }

  async update(user: AuthUser, id: string, version: number, patch: AthletePatch): Promise<Athlete> {
    await this.db.tx(async (tx) => {
      const current = await tx.athleteProfile.findUniqueOrThrow({ where: { id }, include: { person: true } });
      if (patch.status && patch.status !== current.status) {
        const change = checkStatusChange(current.status, patch.status);
        if (!change.ok)
          throw new DomainError('INVALID_TRANSITION', {
            from: current.status,
            to: patch.status,
            allowed: change.allowed,
          });
        if (change.permission === 'athlete.archive') await this.access.assert(user, 'athlete.archive', id);
      }
      const { count } = await tx.athleteProfile.updateMany({
        where: { id, version },
        data: { status: patch.status, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version);
      const person = patch.person ? await this.people.update(tx, current.personId, patch.person) : null;
      await this.audit.record(tx, {
        action: 'athlete.updated',
        entityType: 'AthleteProfile',
        entityId: id,
        before: { status: current.status, ...(person ? personAudit(person.before) : {}) },
        after: { status: patch.status ?? current.status, ...(person ? personAudit(person.after) : {}) },
      });
    });
    return this.get(user, id);
  }

  async archive(user: AuthUser, id: string, reason: string): Promise<Athlete> {
    await this.db.tx(async (tx) => {
      const current = await tx.athleteProfile.findUniqueOrThrow({ where: { id } });
      const change = checkStatusChange(current.status, 'ARCHIVED');
      if (!change.ok)
        throw new DomainError('INVALID_TRANSITION', { from: current.status, to: 'ARCHIVED', allowed: [] });
      await tx.athleteProfile.update({
        where: { id },
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'athlete.archived',
        entityType: 'AthleteProfile',
        entityId: id,
        before: { status: current.status },
        after: { status: 'ARCHIVED' },
        reason,
      });
    });
    return this.get(user, id);
  }

  /** Публичное имя спортсмена для писем и списков (Q-04). */
  async publicNameOf(athleteId: string): Promise<string> {
    const a = await this.db.athleteProfile.findUniqueOrThrow({
      where: { id: athleteId },
      include: { person: true },
    });
    return publicName(a.person.lastName, a.person.firstName);
  }
}
