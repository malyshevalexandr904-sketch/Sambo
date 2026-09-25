// Тренеры (API.md, 4.3): профиль тренера и его работа в организациях. Тренер может не иметь аккаунта;
// права тренера-пользователя даёт членство с ролью COACH, а связь со спортсменами — AthleteCoach.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CoachCreate,
  type CoachesQuery,
  type CoachPatch,
  type CoachSummary,
  fullName,
  type Page,
  publicName,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { AuditService } from '../../audit';
import { OrganizationScopeService } from '../../organizations';
import { PeopleService } from '../../people';

const todayDate = (): Date => new Date(new Date().toISOString().slice(0, 10));

const COACH_INCLUDE = {
  person: true,
  memberships: {
    where: { OR: [{ validTo: null }, { validTo: { gte: todayDate() } }] },
    include: { organization: { select: { id: true, shortName: true } } },
  },
} satisfies Prisma.CoachProfileInclude;

type CoachRow = Prisma.CoachProfileGetPayload<{ include: typeof COACH_INCLUDE }>;

@Injectable()
export class CoachesService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly registry: ScopeResolverRegistry,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register('coach', async (id) => ({ scopes: await this.scopesOf(id) }));
  }

  /** Области тренера — организации, где он сейчас работает. */
  async scopesOf(coachId: string | undefined): Promise<ResourceScope[]> {
    if (!coachId) throw new DomainError('NOT_FOUND', { resource: 'coach' });
    const coach = await this.db.coachProfile.findUnique({
      where: { id: coachId },
      include: { memberships: { where: { OR: [{ validTo: null }, { validTo: { gte: todayDate() } }] } } },
    });
    if (!coach) throw new DomainError('NOT_FOUND', { resource: 'coach' });
    const scopes = await Promise.all(coach.memberships.map((m) => this.orgScopes.scopeOf(m.organizationId)));
    return scopes.map((s) => ({ ...s, visibleToAll: false }));
  }

  private summary(c: CoachRow, userId: string | null): CoachSummary {
    return {
      id: c.id,
      personId: c.personId,
      name: fullName(c.person),
      publicName: publicName(c.person.lastName, c.person.firstName),
      userId,
      status: c.status,
      organizations: c.memberships.map((m) => ({
        id: m.organization.id,
        shortName: m.organization.shortName,
      })),
      version: c.version,
    };
  }

  /** Организации, тренеров которых пользователь видит: свои и дочерние; платформа — все. */
  private async visibleOrganizations(user: AuthUser): Promise<string[] | 'all'> {
    const grants = await this.policy.grants(user);
    if (grants.platform.length > 0) return 'all';
    const own = grants.organizations
      .filter((g) => g.organizationStatus === 'ACTIVE')
      .map((g) => g.organizationId);
    if (own.length === 0) return [];
    const rows = await this.db.organizationClosure.findMany({
      where: { ancestorId: { in: own } },
      select: { descendantId: true },
    });
    return [...new Set(rows.map((r) => r.descendantId))];
  }

  async list(user: AuthUser, q: CoachesQuery): Promise<Page<CoachSummary>> {
    const visible = await this.visibleOrganizations(user);
    if (q.organizationId && visible !== 'all' && !visible.includes(q.organizationId))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    const orgFilter = q.organizationId ? [q.organizationId] : visible;
    const cursor = decodeCursor(q.cursor);
    const needle = q.q?.toLowerCase().replaceAll('ё', 'е');
    const personIds = needle
      ? (
          await this.db.$queryRaw<{ id: string }[]>`
            SELECT id FROM person WHERE last_name_norm LIKE ${needle + '%'} OR first_name_norm LIKE ${needle + '%'} LIMIT 1000`
        ).map((r) => r.id)
      : undefined;
    const rows = await this.db.coachProfile.findMany({
      where: {
        status: q.status,
        personId: personIds ? { in: personIds } : undefined,
        memberships:
          orgFilter === 'all'
            ? undefined
            : {
                some: {
                  organizationId: { in: orgFilter },
                  OR: [{ validTo: null }, { validTo: { gte: todayDate() } }],
                },
              },
        ...(cursor
          ? {
              OR: [
                { person: { lastName: { gt: cursor.k } } },
                { person: { lastName: cursor.k }, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ person: { lastName: 'asc' } }, { id: 'asc' }],
      take: q.limit + 1,
      include: { ...COACH_INCLUDE, person: { include: { user: { select: { id: true } } } } },
    });
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.person.lastName, id: r.id }),
      (r) => this.summary(r, r.person.user?.id ?? null),
    );
  }

  async get(id: string): Promise<CoachSummary> {
    const row = await this.db.coachProfile.findUniqueOrThrow({
      where: { id },
      include: { ...COACH_INCLUDE, person: { include: { user: { select: { id: true } } } } },
    });
    return this.summary(row, row.person.user?.id ?? null);
  }

  /** Профиль тренера и работа в организации. Повторное добавление в ту же организацию — ALREADY_EXISTS. */
  async create(user: AuthUser, input: CoachCreate): Promise<CoachSummary> {
    const scope = await this.orgScopes.scopeOf(input.organizationId);
    if (!(await this.policy.isVisible(user, scope)))
      throw new DomainError('NOT_FOUND', { resource: 'organization' });
    await this.policy.assert(user, 'coach.manage', scope);
    const coachId = await this.db.tx(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
      if (org.status !== 'ACTIVE')
        throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: org.id });
      const personId = input.userId
        ? await this.personOfMember(tx, input.userId, input.organizationId)
        : await this.newPerson(tx, user, input);
      const coach = await this.ensureProfile(tx, personId, user.id);
      const open = await tx.coachMembership.findFirst({
        where: { coachId: coach.id, organizationId: input.organizationId, validTo: null },
      });
      if (open) throw new DomainError('ALREADY_EXISTS', { resource: 'coach_membership' });
      await this.addMembership(tx, coach.id, input.organizationId, user.id);
      return coach.id;
    });
    return this.get(coachId);
  }

  private async personOfMember(tx: Tx, userId: string, organizationId: string): Promise<string> {
    const member = await tx.organizationMembership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
      include: { user: { select: { personId: true } } },
    });
    if (!member)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'userId', code: 'not_member' }] });
    if (!member.user?.personId)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'userId', code: 'person_required' }] });
    return member.user.personId;
  }

  private async newPerson(tx: Tx, user: AuthUser, input: CoachCreate): Promise<string> {
    if (!input.person)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'person', code: 'required' }] });
    if (!input.confirmNotDuplicate) {
      const dupes = await this.people.exactMatches(tx, input.person);
      if (dupes.length > 0) throw new DomainError('POSSIBLE_DUPLICATE', { count: dupes.length });
    }
    return (await this.people.create(tx, input.person, user.id)).id;
  }

  private async ensureProfile(tx: Tx, personId: string, actorId: string): Promise<{ id: string }> {
    const existing = await tx.coachProfile.findUnique({ where: { personId } });
    if (existing) return existing;
    const created = await tx.coachProfile.create({ data: { id: uuidv7(), personId, createdById: actorId } });
    await this.audit.record(tx, {
      action: 'coach.created',
      entityType: 'CoachProfile',
      entityId: created.id,
      after: { personId },
    });
    return created;
  }

  private async addMembership(
    tx: Tx,
    coachId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    await tx.coachMembership.create({
      data: { id: uuidv7(), coachId, organizationId, validFrom: todayDate(), createdById: actorId },
    });
    await this.audit.record(tx, {
      action: 'coach.membership_added',
      entityType: 'CoachProfile',
      entityId: coachId,
      organizationId,
      after: { organizationId },
    });
  }

  /**
   * Профиль тренера пользователя с ролью COACH в организации: создаётся при первом спортсмене,
   * чтобы тренер сразу стал его тренером (COACH_OWN). Без записи «человек» у пользователя — null.
   */
  async ensureForUser(tx: Tx, userId: string, organizationId: string): Promise<string | null> {
    const person = await this.people.personOfUser(tx, userId);
    if (!person) return null;
    const coach = await this.ensureProfile(tx, person.id, userId);
    const open = await tx.coachMembership.findFirst({
      where: { coachId: coach.id, organizationId, validTo: null },
    });
    if (!open) await this.addMembership(tx, coach.id, organizationId, userId);
    return coach.id;
  }

  /** Профиль тренера текущего пользователя (по его записи «человек»). */
  async coachIdOfUser(user: AuthUser): Promise<string | null> {
    if (!user.personId) return null;
    const coach = await this.db.coachProfile.findUnique({
      where: { personId: user.personId },
      select: { id: true },
    });
    return coach?.id ?? null;
  }

  /** Тренер работает хотя бы в одной из организаций (сейчас). */
  async worksIn(tx: Tx, coachId: string, organizationIds: string[]): Promise<boolean> {
    const m = await tx.coachMembership.findFirst({
      where: {
        coachId,
        organizationId: { in: organizationIds },
        OR: [{ validTo: null }, { validTo: { gte: todayDate() } }],
      },
      select: { id: true },
    });
    return m !== null;
  }

  async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.coachProfile.findMany({
      where: { id: { in: ids } },
      include: { person: true },
    });
    return new Map(rows.map((r) => [r.id, fullName(r.person)]));
  }

  async update(id: string, version: number, patch: CoachPatch): Promise<CoachSummary> {
    await this.db.tx(async (tx) => {
      const coach = await tx.coachProfile.findUniqueOrThrow({ where: { id } });
      const { count } = await tx.coachProfile.updateMany({
        where: { id, version },
        data: { status: patch.status, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(coach.version);
      await this.audit.record(tx, {
        action: 'coach.updated',
        entityType: 'CoachProfile',
        entityId: id,
        before: { status: coach.status },
        after: { status: patch.status },
      });
    });
    return this.get(id);
  }

  /** Тренер больше не работает в организации: период закрывается сегодняшним днём. */
  async endMembership(user: AuthUser, id: string, organizationId: string): Promise<CoachSummary> {
    const scope = await this.orgScopes.scopeOf(organizationId);
    await this.policy.assert(user, 'coach.manage', scope);
    await this.db.tx(async (tx) => {
      const open = await tx.coachMembership.findFirst({
        where: { coachId: id, organizationId, validTo: null },
      });
      if (!open) throw new DomainError('NOT_FOUND', { resource: 'coach_membership' });
      await tx.coachMembership.update({ where: { id: open.id }, data: { validTo: todayDate() } });
      await this.audit.record(tx, {
        action: 'coach.membership_ended',
        entityType: 'CoachProfile',
        entityId: id,
        organizationId,
        before: { organizationId, validTo: null },
        after: { organizationId, validTo: todayDate() },
      });
    });
    return this.get(id);
  }
}
