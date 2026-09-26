// Турнир (API.md, 5.1): создание, изменение, удаление черновика, переходы статуса (ARCHITECTURE.md, 16.1).
// Каждая команда — одна транзакция: изменение + AuditLog + OutboxEvent; операционные — под правом записи.
import { Injectable } from '@nestjs/common';
import {
  type Competition,
  type CompetitionCreate,
  type CompetitionPatch,
  type CompetitionsQuery,
  type CompetitionStatus,
  type CompetitionSummary,
  type CompetitionTransitionRequest,
  type Page,
  type PermissionCode,
  ROLE_PERMISSIONS,
  ROLES,
  type RoleCode,
  scheduleIssues,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type EffectiveGrants, PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';
import { OrganizationScopeService, slugify } from '../../organizations';
import { OutboxService } from '../../outbox';
import { RuleSetsService } from '../../rulesets';
import { WriteLeaseService } from '../../venue-sync';
import {
  findTransition,
  isPublished,
  publishIssues,
  registrationWindow,
  reopenIssues,
  transitionsFrom,
} from '../domain/competition-machine';
import { competitionSlugBase } from '../domain/competition-slug';
import { CompetitionExtensions, type TransitionContext } from './competition-extensions';
import { type CompetitionBasics, CompetitionScopeService } from './competition-scope.service';
import { COMPETITION_INCLUDE, type CompetitionRow, toBasics, toSummary } from './competition-mapper';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** Действия над турниром для allowedActions (UI скрывает недоступное, решает сервер). */
const ACTION_CANDIDATES: readonly PermissionCode[] = [
  'competition.view',
  'competition.update',
  'competition.delete',
  'competition.members.manage',
  'competition_category.manage',
  'category.merge',
  'registration.view',
  'registration.approve',
  'registration.reject',
  'registration.return',
  'registration.export',
  'entry.withdraw',
  'entry.transfer',
  'document.verify',
  'audit.view',
];

/** Поля расписания: их изменение у опубликованного турнира требует причины и уведомляет участников. */
const SCHEDULE_FIELDS = [
  'timezone',
  'startDate',
  'endDate',
  'registrationStartsAt',
  'registrationEndsAt',
] as const;

@Injectable()
export class CompetitionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly scopes: CompetitionScopeService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly extensions: CompetitionExtensions,
    private readonly leases: WriteLeaseService,
    private readonly rulesets: RuleSetsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Чтение ----------

  /**
   * Видимость черновиков: платформа, организации с правом просмотра турниров (организатор ▲, федерация — с
   * дочерними) и персонал турнира. Опубликованные турниры видит любой вошедший.
   */
  private staffFilter(grants: EffectiveGrants): Prisma.CompetitionWhereInput | 'all' {
    const canView = (roles: RoleCode[]): boolean =>
      roles.some((r) => ROLE_PERMISSIONS[r]['competition.view'] !== undefined);
    if (canView(grants.platform)) return 'all';
    const direct: string[] = [];
    const withDescendants: string[] = [];
    for (const g of grants.organizations) {
      if (g.organizationStatus !== 'ACTIVE') continue;
      for (const r of g.roles) {
        if (ROLE_PERMISSIONS[r]['competition.view'] === undefined) continue;
        (ROLES[r].inheritsToDescendants ? withDescendants : direct).push(g.organizationId);
      }
    }
    const or: Prisma.CompetitionWhereInput[] = [];
    if (direct.length > 0) or.push({ organizerOrganizationId: { in: direct } });
    if (withDescendants.length > 0)
      or.push({ organizer: { ancestors: { some: { ancestorId: { in: withDescendants } } } } });
    const staffOf = grants.competitions.filter((g) => canView(g.roles)).map((g) => g.competitionId);
    if (staffOf.length > 0) or.push({ id: { in: staffOf } });
    return or.length > 0 ? { OR: or } : { id: { in: [] } };
  }

  async list(user: AuthUser, q: CompetitionsQuery): Promise<Page<CompetitionSummary>> {
    const staff = this.staffFilter(await this.policy.grants(user));
    const and: Prisma.CompetitionWhereInput[] = [{ deletedAt: null }];
    if (q.mine) {
      if (staff !== 'all') and.push(staff);
    } else if (staff !== 'all') {
      and.push({ OR: [{ status: { not: 'DRAFT' } }, staff] });
    }
    if (q.status) and.push({ status: q.status });
    if (q.organizerId) and.push({ organizerOrganizationId: q.organizerId });
    if (q.from) and.push({ endDate: { gte: toDate(q.from) } });
    if (q.to) and.push({ startDate: { lte: toDate(q.to) } });
    if (q.q) and.push({ name: { contains: q.q, mode: 'insensitive' } });
    if (q.registrationOpen) {
      const now = new Date();
      and.push({
        status: 'REGISTRATION_OPEN',
        registrationStartsAt: { lte: now },
        registrationEndsAt: { gt: now },
      });
    }
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      const at = toDate(cursor.k);
      and.push({ OR: [{ startDate: { lt: at } }, { startDate: at, id: { lt: cursor.id } }] });
    }
    const rows = await this.db.competition.findMany({
      where: { AND: and },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: COMPETITION_INCLUDE,
    });
    const now = new Date();
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: dateOnly(r.startDate), id: r.id }),
      (r) => toSummary(r, now, (key) => this.files.publicUrl(key)),
    );
  }

  private async loadRow(id: string): Promise<CompetitionRow> {
    const row = await this.db.competition.findFirst({
      where: { id, deletedAt: null },
      include: COMPETITION_INCLUDE,
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return row;
  }

  /** Черновик виден только тем, у кого есть `competition.view`; опубликованный турнир — любому вошедшему. */
  async get(user: AuthUser, id: string): Promise<Competition> {
    const row = await this.loadRow(id);
    const scope = await this.scopes.scopeFor(row);
    if (row.status === 'DRAFT') await this.policy.assert(user, 'competition.view', scope);
    return this.toDto(user, row);
  }

  private async toDto(user: AuthUser, row: CompetitionRow): Promise<Competition> {
    const scope = await this.scopes.scopeFor(row);
    const grants = await this.policy.grants(user);
    const actions: string[] = await this.policy.allowedActions(user, scope, ACTION_CANDIDATES);
    for (const t of transitionsFrom(row.status)) {
      if (await this.policy.can(user, t.permission, scope)) actions.push(`transition:${t.to}`);
    }
    const roles = grants.competitions.find((g) => g.competitionId === row.id)?.roles ?? [];
    const version = row.ruleSetVersionId ? await this.rulesets.versionInfo(row.ruleSetVersionId) : null;
    return {
      ...toSummary(row, new Date(), (key) => this.files.publicUrl(key)),
      descriptionMd: row.descriptionMd,
      ruleSetVersion: version
        ? {
            id: version.id,
            ruleSetId: version.ruleSetId,
            ruleSetCode: version.ruleSetCode,
            ruleSetName: version.ruleSetName,
            version: version.version,
            status: version.status,
            checksum: version.checksum,
          }
        : null,
      logoFileId: row.logoFileId,
      regulation: row.regulation
        ? {
            fileId: row.regulation.id,
            fileName: row.regulation.originalName,
            url:
              row.regulation.status === 'AVAILABLE' ? this.files.publicUrl(row.regulation.storageKey) : null,
          }
        : null,
      requirementsMd: row.requirementsMd,
      contactInfo: (row.contactInfo as Competition['contactInfo']) ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      counters: await this.extensions.countersFor(row.id),
      writeAuthority: await this.leases.authority(row.id),
      viewer: { roles, staff: actions.includes('competition.view') },
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions: actions,
    };
  }

  // ---------- Проверки ссылок ----------

  private async assertDiscipline(tx: Tx, code: string): Promise<void> {
    if (!(await tx.discipline.findUnique({ where: { code } })))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'disciplineCode', code: 'not_found' }] });
  }

  /** Место — организатора или вышестоящей организации (федерации). */
  private async assertVenue(tx: Tx, venueId: string, organizerId: string): Promise<void> {
    const venue = await tx.venue.findFirst({ where: { id: venueId, deletedAt: null } });
    const lineage = (await this.orgScopes.scopeOf(organizerId)).ancestorIds;
    if (!venue || !lineage.includes(venue.ownerOrganizationId))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'venueId', code: 'not_found' }] });
  }

  /** Закрепляется только опубликованная версия правил дисциплины турнира, доступная организатору. */
  private async assertRuleSetVersion(
    tx: Tx,
    versionId: string,
    disciplineCode: string,
    organizerId: string,
  ): Promise<void> {
    const v = await this.rulesets.versionInfo(versionId, tx);
    const lineage = (await this.orgScopes.scopeOf(organizerId)).ancestorIds;
    const fail = (code: string): never => {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'ruleSetVersionId', code }] });
    };
    if (!v || (v.ownerOrganizationId !== null && !lineage.includes(v.ownerOrganizationId))) fail('not_found');
    if (v?.status !== 'PUBLISHED') fail('ruleset_not_published');
    if (v?.disciplineCode !== disciplineCode) fail('ruleset_discipline_mismatch');
  }

  private async uniqueSlug(
    tx: Tx,
    name: string,
    startDate: string,
    requested?: string,
    excludeId?: string,
  ): Promise<string> {
    const taken = async (slug: string): Promise<boolean> =>
      (await tx.competition.findFirst({
        where: { slug, id: excludeId ? { not: excludeId } : undefined },
        select: { id: true },
      })) !== null;
    if (requested) {
      if (await taken(requested)) throw new DomainError('SLUG_TAKEN');
      return requested;
    }
    const base = competitionSlugBase(slugify(name), startDate);
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? base : `${base.slice(0, 74)}-${i}`;
      if (!(await taken(candidate))) return candidate;
    }
    return `${base.slice(0, 60)}-${uuidv7().slice(-8)}`;
  }

  // ---------- Команды ----------

  /**
   * Турнир создаёт организация с `competition.create`; организация должна быть активной. Создатель становится
   * руководителем турнира (TOURNAMENT_MANAGER), если действует не через платформенную роль.
   */
  async create(user: AuthUser, input: CompetitionCreate): Promise<Competition> {
    const orgScope = await this.orgScopes.scopeOf(input.organizerOrganizationId);
    const access = await this.policy.assert(user, 'competition.create', orgScope);
    if (!orgScope.visibleToAll)
      throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: input.organizerOrganizationId });
    const id = await this.db.tx(async (tx) => {
      await this.assertDiscipline(tx, input.disciplineCode);
      if (input.venueId) await this.assertVenue(tx, input.venueId, input.organizerOrganizationId);
      if (input.ruleSetVersionId)
        await this.assertRuleSetVersion(
          tx,
          input.ruleSetVersionId,
          input.disciplineCode,
          input.organizerOrganizationId,
        );
      if (input.logoFileId)
        await this.files.assertAttachable(tx, input.logoFileId, user.id, 'COMPETITION_LOGO', 'logoFileId');
      const competitionId = uuidv7();
      const slug = await this.uniqueSlug(tx, input.name, input.startDate, input.slug);
      await tx.competition.create({
        data: {
          id: competitionId,
          slug,
          name: input.name,
          shortName: input.shortName ?? null,
          descriptionMd: input.descriptionMd ?? null,
          organizerOrganizationId: input.organizerOrganizationId,
          venueId: input.venueId ?? null,
          timezone: input.timezone,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          registrationStartsAt: new Date(input.registrationStartsAt),
          registrationEndsAt: new Date(input.registrationEndsAt),
          level: input.level,
          disciplineCode: input.disciplineCode,
          ruleSetVersionId: input.ruleSetVersionId ?? null,
          logoFileId: input.logoFileId ?? null,
          contactInfo: input.contactInfo ?? undefined,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.leases.createCloudLease(tx, competitionId, user.id);
      if (!access.viaPlatform) {
        const role = await tx.role.findUniqueOrThrow({ where: { code: 'TOURNAMENT_MANAGER' } });
        await tx.competitionMembership.create({
          data: {
            id: uuidv7(),
            competitionId,
            userId: user.id,
            roleId: role.id,
            status: 'ACTIVE',
            invitedById: user.id,
          },
        });
        await tx.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
      }
      await this.audit.record(tx, {
        action: 'competition.created',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        organizationId: input.organizerOrganizationId,
        after: {
          slug,
          name: input.name,
          status: 'DRAFT',
          startDate: input.startDate,
          endDate: input.endDate,
        },
      });
      return competitionId;
    });
    // Роль руководителя турнира уже выдана: права пересчитываются по новой версии (новый объект пользователя).
    const viewer = access.viaPlatform ? user : { ...user, permissionsVersion: user.permissionsVersion + 1 };
    return this.toDto(viewer, await this.loadRow(id));
  }

  async update(user: AuthUser, id: string, version: number, patch: CompetitionPatch): Promise<Competition> {
    const updated = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, id);
      const current = await tx.competition.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'competition' });
      if (current.version !== version) throw versionConflict(current.version);
      if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(current.status))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
      const published = isPublished(current.status);
      const failed: string[] = [];
      if (published && patch.disciplineCode !== undefined && patch.disciplineCode !== current.disciplineCode)
        failed.push('published_discipline_locked');
      if (
        published &&
        patch.ruleSetVersionId !== undefined &&
        patch.ruleSetVersionId !== current.ruleSetVersionId
      )
        failed.push('published_ruleset_locked');
      if (published && patch.slug !== undefined && patch.slug !== current.slug)
        failed.push('published_slug_locked');
      if (failed.length > 0) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

      const merged = {
        timezone: patch.timezone ?? current.timezone,
        startDate: patch.startDate ?? dateOnly(current.startDate),
        endDate: patch.endDate ?? dateOnly(current.endDate),
        registrationStartsAt: patch.registrationStartsAt ?? current.registrationStartsAt.toISOString(),
        registrationEndsAt: patch.registrationEndsAt ?? current.registrationEndsAt.toISOString(),
      };
      const issues = scheduleIssues(merged);
      if (issues.length > 0) throw new DomainError('VALIDATION_FAILED', { fields: issues });
      const scheduleChanged = SCHEDULE_FIELDS.some((f) => {
        const next = patch[f];
        if (next === undefined) return false;
        if (f === 'timezone') return next !== current.timezone;
        if (f === 'startDate' || f === 'endDate') return next !== dateOnly(current[f]);
        return Date.parse(next) !== current[f].getTime();
      });
      if (published && scheduleChanged && !patch.reason) throw new DomainError('REASON_REQUIRED');

      const discipline = patch.disciplineCode ?? current.disciplineCode;
      if (patch.disciplineCode !== undefined) await this.assertDiscipline(tx, patch.disciplineCode);
      if (patch.venueId) await this.assertVenue(tx, patch.venueId, current.organizerOrganizationId);
      if (patch.ruleSetVersionId)
        await this.assertRuleSetVersion(
          tx,
          patch.ruleSetVersionId,
          discipline,
          current.organizerOrganizationId,
        );
      else if (
        patch.disciplineCode !== undefined &&
        current.ruleSetVersionId &&
        patch.ruleSetVersionId !== null
      ) {
        const v = await this.rulesets.versionInfo(current.ruleSetVersionId, tx);
        if (v?.disciplineCode !== discipline)
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: 'ruleSetVersionId', code: 'ruleset_discipline_mismatch' }],
          });
      }
      if (patch.logoFileId && patch.logoFileId !== current.logoFileId)
        await this.files.assertAttachable(tx, patch.logoFileId, user.id, 'COMPETITION_LOGO', 'logoFileId');
      const slug =
        patch.slug !== undefined && patch.slug !== current.slug
          ? await this.uniqueSlug(tx, current.name, merged.startDate, patch.slug, id)
          : undefined;

      const data: Prisma.CompetitionUncheckedUpdateManyInput = {
        name: patch.name,
        shortName: patch.shortName,
        slug,
        descriptionMd: patch.descriptionMd,
        venueId: patch.venueId,
        timezone: patch.timezone,
        startDate: patch.startDate ? toDate(patch.startDate) : undefined,
        endDate: patch.endDate ? toDate(patch.endDate) : undefined,
        registrationStartsAt: patch.registrationStartsAt ? new Date(patch.registrationStartsAt) : undefined,
        registrationEndsAt: patch.registrationEndsAt ? new Date(patch.registrationEndsAt) : undefined,
        level: patch.level,
        disciplineCode: patch.disciplineCode,
        ruleSetVersionId: patch.ruleSetVersionId,
        logoFileId: patch.logoFileId,
        contactInfo: patch.contactInfo !== undefined ? patch.contactInfo : undefined,
        updatedById: user.id,
        version: { increment: 1 },
      };
      const { count } = await tx.competition.updateMany({ where: { id, version }, data });
      if (count === 0) throw versionConflict(current.version + 1);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'reason' || v === undefined) continue;
        before[k] = (current as Record<string, unknown>)[k] ?? null;
        after[k] = v;
      }
      await this.audit.record(tx, {
        action: 'competition.updated',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: current.organizerOrganizationId,
        before,
        after,
        reason: patch.reason ?? null,
      });
      if (published && scheduleChanged)
        await this.outbox.enqueue(tx, {
          type: 'competition.dates_changed',
          aggregate: { type: 'Competition', id },
          competitionId: id,
          payload: { competitionId: id },
        });
      return id;
    });
    return this.toDto(user, await this.loadRow(updated));
  }

  /** Удаляется только черновик (soft delete); его персонал теряет роли. */
  async remove(id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const current = await tx.competition.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'competition' });
      if (current.status !== 'DRAFT')
        throw new DomainError('INVALID_TRANSITION', { from: current.status, to: 'DELETED', allowed: [] });
      await tx.competition.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      const staff = await tx.competitionMembership.findMany({
        where: { competitionId: id, status: { in: ['INVITED', 'ACTIVE', 'SUSPENDED'] } },
        select: { id: true, userId: true },
      });
      await tx.competitionMembership.updateMany({
        where: { id: { in: staff.map((s) => s.id) } },
        data: { status: 'ENDED', version: { increment: 1 } },
      });
      const userIds = staff.map((s) => s.userId).filter((u): u is string => u !== null);
      if (userIds.length > 0)
        await tx.user.updateMany({
          where: { id: { in: userIds } },
          data: { permissionsVersion: { increment: 1 } },
        });
      await this.audit.record(tx, {
        action: 'competition.deleted',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: current.organizerOrganizationId,
        before: { status: 'DRAFT', slug: current.slug },
      });
    });
  }

  /**
   * Переход статуса (ARCHITECTURE.md, 16.1). Право зависит от перехода: публикация — `competition.publish`,
   * остальные — `competition.transition`. Условия других модулей регистрируются в CompetitionExtensions.
   */
  async transition(
    user: AuthUser,
    id: string,
    version: number,
    req: CompetitionTransitionRequest,
  ): Promise<Competition> {
    const basics = await this.scopes.require(id);
    const def = findTransition(basics.status, req.to);
    if (!def)
      throw new DomainError('INVALID_TRANSITION', {
        from: basics.status,
        to: req.to,
        allowed: transitionsFrom(basics.status).map((t) => t.to),
      });
    const scope = await this.scopes.scopeFor(basics);
    const access = await this.policy.assert(user, def.permission, scope);
    if (def.reasonRequired && !req.reason) throw new DomainError('REASON_REQUIRED');

    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, id);
      const locked = await tx.$queryRaw<{ version: number; status: CompetitionStatus }[]>`
        SELECT version, status FROM competition WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked[0] || locked[0].status !== basics.status || locked[0].version !== version)
        throw versionConflict(locked[0]?.version ?? version);
      const now = new Date();
      const competition = (await this.scopes.basics(id)) as CompetitionBasics;
      await this.ownChecks(tx, competition, req, now);
      const ctx: TransitionContext = {
        tx,
        competition,
        from: basics.status,
        to: req.to,
        reason: req.reason ?? null,
        userId: user.id,
        now,
      };
      const checks = await this.extensions.check(ctx);
      if (checks.blocking.length > 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
          failed: checks.blocking,
          warnings: checks.warnings,
        });
      if (checks.warnings.length > 0 && !req.confirm)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
          failed: [],
          warnings: checks.warnings,
          confirmable: true,
        });

      const data: Prisma.CompetitionUncheckedUpdateInput = {
        status: req.to,
        version: { increment: 1 },
        updatedById: user.id,
      };
      if (req.to === 'REGISTRATION_OPEN' && basics.status === 'DRAFT') data.publishedAt = now;
      if (req.to === 'REGISTRATION_OPEN' && basics.status === 'REGISTRATION_CLOSED' && req.registrationEndsAt)
        data.registrationEndsAt = new Date(req.registrationEndsAt);
      if (req.to === 'CANCELLED') {
        data.cancelledAt = now;
        data.cancelReason = req.reason ?? null;
      }
      await tx.competition.update({ where: { id }, data });
      await this.extensions.apply(ctx);
      await this.audit.record(tx, {
        action: 'competition.status_changed',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: basics.organizerOrganizationId,
        before: { status: basics.status },
        after: {
          status: req.to,
          ...(data.registrationEndsAt ? { registrationEndsAt: req.registrationEndsAt } : {}),
          ...(checks.warnings.length > 0 ? { confirmedWarnings: checks.warnings } : {}),
        },
        reason: req.reason ?? null,
        platformIntervention: access.viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'competition.status_changed',
        aggregate: { type: 'Competition', id },
        competitionId: id,
        payload: { competitionId: id, from: basics.status, to: req.to },
      });
      if (req.to === 'REGISTRATION_OPEN' && basics.status === 'DRAFT')
        await this.outbox.enqueue(tx, {
          type: 'competition.published',
          aggregate: { type: 'Competition', id },
          competitionId: id,
          payload: { competitionId: id },
        });
    });
    return this.toDto(user, await this.loadRow(id));
  }

  /** Условия самого турнира: правила и сроки при публикации, новый срок при продлении регистрации. */
  private async ownChecks(
    tx: Tx,
    c: CompetitionBasics,
    req: CompetitionTransitionRequest,
    now: Date,
  ): Promise<void> {
    const schedule = {
      timezone: c.timezone,
      startDate: c.startDate,
      endDate: c.endDate,
      registrationStartsAt: c.registrationStartsAt.toISOString(),
      registrationEndsAt: c.registrationEndsAt.toISOString(),
    };
    if (c.status === 'DRAFT' && req.to === 'REGISTRATION_OPEN') {
      if (!c.ruleSetVersionId) throw new DomainError('RULESET_REQUIRED');
      const v = await this.rulesets.versionInfo(c.ruleSetVersionId, tx);
      const failed = publishIssues(
        {
          ...schedule,
          ruleSetVersionStatus: v?.status ?? 'RETIRED',
          ruleSetDisciplineMatches: v?.disciplineCode === c.disciplineCode,
        },
        now,
      );
      if (failed.length > 0) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });
    }
    if (c.status === 'REGISTRATION_CLOSED' && req.to === 'REGISTRATION_OPEN') {
      const failed = reopenIssues(schedule, req.registrationEndsAt, now);
      if (failed.length > 0) throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });
    }
  }

  /** Сведения для соседних модулей: окно регистрации сейчас. */
  registrationWindowOf(c: CompetitionBasics, now = new Date()): ReturnType<typeof registrationWindow> {
    return registrationWindow(c, now);
  }

  toBasics(row: CompetitionRow): CompetitionBasics {
    return toBasics(row);
  }
}
