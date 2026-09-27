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
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';
import { OrganizationScopeService } from '../../organizations';
import { OutboxService } from '../../outbox';
import { RuleSetsService } from '../../rulesets';
import { WriteLeaseService } from '../../venue-sync';
import {
  findTransition,
  publishIssues,
  registrationWindow,
  reopenIssues,
  transitionsFrom,
} from '../domain/competition-machine';
import {
  assertEditable,
  auditDiff,
  createData,
  dateOnly,
  mergedSchedule,
  transitionData,
  updateData,
} from './competition-edit';
import { CompetitionExtensions, type TransitionContext } from './competition-extensions';
import { listWhere, staffFilter } from './competition-queries';
import { CompetitionReferences } from './competition-references';
import { type CompetitionBasics, CompetitionScopeService } from './competition-scope.service';
import {
  ACTION_CANDIDATES,
  COMPETITION_INCLUDE,
  type CompetitionRow,
  toBasics,
  toRegulation,
  toRuleSetVersionRef,
  toSummary,
} from './competition-mapper';

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
    private readonly refs: CompetitionReferences,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Чтение ----------

  async list(user: AuthUser, q: CompetitionsQuery): Promise<Page<CompetitionSummary>> {
    const and = listWhere(q, staffFilter(await this.policy.grants(user)), new Date());
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
      ruleSetVersion: version ? toRuleSetVersionRef(version) : null,
      logoFileId: row.logoFileId,
      regulation: toRegulation(row, (key) => this.files.publicUrl(key)),
      requirementsMd: row.requirementsMd,
      contactInfo: (row.contactInfo as Competition['contactInfo']) ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      counters: await this.extensions.countersFor(row.id),
      weighInFailureOutcome: row.weighInFailureOutcome,
      writeAuthority: await this.leases.authority(row.id),
      viewer: { roles, staff: actions.includes('competition.view') },
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions: actions,
    };
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
      await this.refs.assertDiscipline(tx, input.disciplineCode);
      if (input.venueId) await this.refs.assertVenue(tx, input.venueId, input.organizerOrganizationId);
      if (input.ruleSetVersionId)
        await this.refs.assertRuleSetVersion(
          tx,
          input.ruleSetVersionId,
          input.disciplineCode,
          input.organizerOrganizationId,
        );
      if (input.logoFileId) await this.refs.assertLogo(tx, input.logoFileId, user);
      const competitionId = uuidv7();
      const slug = await this.refs.uniqueSlug(tx, input.name, input.startDate, input.slug);
      await tx.competition.create({ data: createData(input, competitionId, slug, user.id) });
      await this.leases.createCloudLease(tx, competitionId, user.id);
      if (!access.viaPlatform) await this.grantManager(tx, competitionId, user.id);
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
    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, id);
      const current = await tx.competition.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'competition' });
      if (current.version !== version) throw versionConflict(current.version);
      const { scheduleChanged } = assertEditable(current, patch);
      await this.refs.assertPatch(tx, user, current, patch);
      const slug =
        patch.slug !== undefined && patch.slug !== current.slug
          ? await this.refs.uniqueSlug(
              tx,
              current.name,
              mergedSchedule(current, patch).startDate,
              patch.slug,
              id,
            )
          : undefined;
      const { count } = await tx.competition.updateMany({
        where: { id, version },
        data: updateData(patch, slug, user.id),
      });
      if (count === 0) throw versionConflict(current.version + 1);
      await this.audit.record(tx, {
        action: 'competition.updated',
        entityType: 'Competition',
        entityId: id,
        competitionId: id,
        organizationId: current.organizerOrganizationId,
        ...auditDiff(current, patch),
        reason: patch.reason ?? null,
      });
      if (scheduleChanged)
        await this.outbox.enqueue(tx, {
          type: 'competition.dates_changed',
          aggregate: { type: 'Competition', id },
          competitionId: id,
          payload: { competitionId: id },
        });
    });
    return this.toDto(user, await this.loadRow(id));
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
      const warnings = await this.checkExtensions(ctx, req.confirm === true);
      const data = transitionData(basics.status, req, user.id, now);
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
          ...(warnings.length > 0 ? { confirmedWarnings: warnings } : {}),
        },
        reason: req.reason ?? null,
        platformIntervention: access.viaPlatform,
      });
      await this.transitionEvents(tx, id, basics.status, req.to);
    });
    return this.toDto(user, await this.loadRow(id));
  }

  /**
   * Условия модулей-расширений: блокирующие — отказ; предупреждения — отказ с `confirmable`, пока пользователь
   * не подтвердит переход (`confirm: true`). Возвращает подтверждённые предупреждения.
   */
  private async checkExtensions(ctx: TransitionContext, confirm: boolean): Promise<string[]> {
    const checks = await this.extensions.check(ctx);
    if (checks.blocking.length > 0)
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
        failed: checks.blocking,
        warnings: checks.warnings,
      });
    if (checks.warnings.length > 0 && !confirm)
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', {
        failed: [],
        warnings: checks.warnings,
        confirmable: true,
      });
    return checks.warnings;
  }

  private async transitionEvents(
    tx: Tx,
    id: string,
    from: CompetitionStatus,
    to: CompetitionStatus,
  ): Promise<void> {
    const aggregate = { type: 'Competition', id };
    await this.outbox.enqueue(tx, {
      type: 'competition.status_changed',
      aggregate,
      competitionId: id,
      payload: { competitionId: id, from, to },
    });
    if (to === 'REGISTRATION_OPEN' && from === 'DRAFT')
      await this.outbox.enqueue(tx, {
        type: 'competition.published',
        aggregate,
        competitionId: id,
        payload: { competitionId: id },
      });
  }

  /** Создатель турнира — его руководитель; права пересчитываются по новой версии пользователя. */
  private async grantManager(tx: Tx, competitionId: string, userId: string): Promise<void> {
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'TOURNAMENT_MANAGER' } });
    await tx.competitionMembership.create({
      data: { id: uuidv7(), competitionId, userId, roleId: role.id, status: 'ACTIVE', invitedById: userId },
    });
    await tx.user.update({ where: { id: userId }, data: { permissionsVersion: { increment: 1 } } });
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
