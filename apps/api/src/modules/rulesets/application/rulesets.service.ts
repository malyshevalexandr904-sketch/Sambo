// Наборы правил и версии (API.md, 4.5; ADR-09): черновик правится, опубликованная версия неизменяема
// и получает контрольную сумму канонического JSON. Турнир закрепляет опубликованную версию (Phase 4).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  canonicalJson,
  type PermissionCode,
  RULESET_SCHEMA_VERSION,
  type RuleSetCreate,
  type RuleSetDto,
  RuleSetParametersV1,
  type RuleSetsQuery,
  type RuleSetVersionCreate,
  type RuleSetVersionDto,
} from '@sde/contracts';
import { type Prisma, type RuleSetVersion, type Tx, uuidv7 } from '@sde/db';
import { sha256Hex } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { AuditService } from '../../audit';
import { OrganizationScopeService } from '../../organizations';

const INCLUDE = {
  ownerOrganization: { select: { id: true, name: true, shortName: true } },
  versions: { orderBy: { version: 'desc' } },
} satisfies Prisma.RuleSetInclude;
type Row = Prisma.RuleSetGetPayload<{ include: typeof INCLUDE }>;

function versionDto(v: RuleSetVersion): RuleSetVersionDto {
  return {
    id: v.id,
    ruleSetId: v.ruleSetId,
    version: v.version,
    schemaVersion: v.schemaVersion,
    status: v.status,
    parameters: v.parameters as Record<string, unknown>,
    checksum: v.checksum,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Параметры проверяются схемой текущей версии; ошибки — по полям (RULESET_PARAMETERS_INVALID). */
export function validateParameters(parameters: unknown): RuleSetParametersV1 {
  const parsed = RuleSetParametersV1.safeParse(parameters);
  if (parsed.success) return parsed.data;
  throw new DomainError('RULESET_PARAMETERS_INVALID', {
    fields: parsed.error.issues.map((i) => ({
      path: ['parameters', ...i.path.map(String)].join('.'),
      code: i.message,
    })),
  });
}

@Injectable()
export class RuleSetsService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly registry: ScopeResolverRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register('ruleset', (id) => this.scopeOf(id));
  }

  /** Шаблон платформы — область платформы; набор организации — её область. */
  async scopeOf(id: string | undefined): Promise<ResourceScope> {
    const rs = id
      ? await this.db.ruleSet.findUnique({ where: { id }, select: { ownerOrganizationId: true } })
      : null;
    if (!rs) throw new DomainError('NOT_FOUND', { resource: 'ruleset' });
    return rs.ownerOrganizationId ? this.orgScopes.scopeOf(rs.ownerOrganizationId) : { kind: 'PLATFORM' };
  }

  private async toDto(user: AuthUser, r: Row): Promise<RuleSetDto> {
    const scope = r.ownerOrganizationId
      ? await this.orgScopes.scopeOf(r.ownerOrganizationId)
      : ({ kind: 'PLATFORM' } as const);
    const actions: PermissionCode[] = (await this.policy.can(user, 'ruleset.manage', scope))
      ? ['ruleset.manage']
      : [];
    const published = r.versions.filter((v) => v.status === 'PUBLISHED').map((v) => v.version);
    return {
      id: r.id,
      code: r.code,
      disciplineCode: r.disciplineCode,
      name: r.name,
      owner: r.ownerOrganization,
      status: r.status,
      latestPublishedVersion: published.length > 0 ? Math.max(...published) : null,
      versions: r.versions.map((v) => {
        const { parameters: _parameters, ...rest } = versionDto(v);
        return rest;
      }),
      allowedActions: actions,
    };
  }

  async list(user: AuthUser, q: RuleSetsQuery): Promise<RuleSetDto[]> {
    const rows = await this.db.ruleSet.findMany({
      where: { disciplineCode: q.disciplineCode, ownerOrganizationId: q.ownerOrganizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: INCLUDE,
      take: 200,
    });
    return Promise.all(rows.map((r) => this.toDto(user, r)));
  }

  async get(user: AuthUser, id: string): Promise<RuleSetDto> {
    const row = await this.db.ruleSet.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'ruleset' });
    return this.toDto(user, row);
  }

  async getVersion(id: string, version: number): Promise<RuleSetVersionDto> {
    const v = await this.db.ruleSetVersion.findUnique({
      where: { ruleSetId_version: { ruleSetId: id, version } },
    });
    if (!v) throw new DomainError('NOT_FOUND', { resource: 'ruleset_version' });
    return versionDto(v);
  }

  async create(user: AuthUser, input: RuleSetCreate): Promise<RuleSetDto> {
    let scope: ResourceScope = { kind: 'PLATFORM' };
    if (input.ownerOrganizationId) {
      scope = await this.orgScopes.scopeOf(input.ownerOrganizationId);
      if (!(await this.policy.isVisible(user, scope)))
        throw new DomainError('NOT_FOUND', { resource: 'organization' });
    }
    await this.policy.assert(user, 'ruleset.manage', scope);
    const id = await this.db.tx(async (tx) => {
      if (!(await tx.discipline.findUnique({ where: { code: input.disciplineCode } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'disciplineCode', code: 'invalid_code' }],
        });
      if (await tx.ruleSet.findUnique({ where: { code: input.code } }))
        throw new DomainError('ALREADY_EXISTS', { resource: 'ruleset' });
      const rs = await tx.ruleSet.create({
        data: {
          id: uuidv7(),
          code: input.code,
          disciplineCode: input.disciplineCode,
          name: input.name,
          ownerOrganizationId: input.ownerOrganizationId ?? null,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'ruleset.created',
        entityType: 'RuleSet',
        entityId: rs.id,
        organizationId: rs.ownerOrganizationId,
        after: { code: rs.code, disciplineCode: rs.disciplineCode, name: rs.name },
      });
      return rs.id;
    });
    return this.get(user, id);
  }

  private async lock(tx: Tx, ruleSetId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rule_set:${ruleSetId}`}))`;
  }

  async createVersion(user: AuthUser, id: string, input: RuleSetVersionCreate): Promise<RuleSetVersionDto> {
    return this.db.tx(async (tx) => {
      await this.lock(tx, id);
      let parameters: unknown = input.parameters;
      if (parameters === undefined) {
        const base = await tx.ruleSetVersion.findUnique({
          where: { ruleSetId_version: { ruleSetId: id, version: input.basedOnVersion as number } },
        });
        if (!base)
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: 'basedOnVersion', code: 'not_found' }],
          });
        parameters = base.parameters;
      }
      const valid = validateParameters(parameters);
      const last = await tx.ruleSetVersion.findFirst({
        where: { ruleSetId: id },
        orderBy: { version: 'desc' },
      });
      const v = await tx.ruleSetVersion.create({
        data: {
          id: uuidv7(),
          ruleSetId: id,
          version: (last?.version ?? 0) + 1,
          schemaVersion: RULESET_SCHEMA_VERSION,
          parameters: valid,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'ruleset.version_created',
        entityType: 'RuleSetVersion',
        entityId: v.id,
        after: { ruleSetId: id, version: v.version, basedOnVersion: input.basedOnVersion ?? null },
      });
      return versionDto(v);
    });
  }

  async updateVersion(id: string, version: number, parameters: unknown): Promise<RuleSetVersionDto> {
    return this.db.tx(async (tx) => {
      await this.lock(tx, id);
      const v = await tx.ruleSetVersion.findUnique({
        where: { ruleSetId_version: { ruleSetId: id, version } },
      });
      if (!v) throw new DomainError('NOT_FOUND', { resource: 'ruleset_version' });
      if (v.status !== 'DRAFT') throw new DomainError('RULESET_VERSION_IMMUTABLE', { status: v.status });
      const valid = validateParameters(parameters);
      const updated = await tx.ruleSetVersion.update({
        where: { id: v.id },
        data: { parameters: valid },
      });
      await this.audit.record(tx, {
        action: 'ruleset.version_updated',
        entityType: 'RuleSetVersion',
        entityId: v.id,
        before: { checksum: sha256Hex(canonicalJson(v.parameters)) },
        after: { checksum: sha256Hex(canonicalJson(valid)) },
      });
      return versionDto(updated);
    });
  }

  async publish(user: AuthUser, id: string, version: number): Promise<RuleSetVersionDto> {
    return this.db.tx(async (tx) => {
      await this.lock(tx, id);
      const v = await tx.ruleSetVersion.findUnique({
        where: { ruleSetId_version: { ruleSetId: id, version } },
      });
      if (!v) throw new DomainError('NOT_FOUND', { resource: 'ruleset_version' });
      if (v.status !== 'DRAFT')
        throw new DomainError('INVALID_TRANSITION', { from: v.status, to: 'PUBLISHED', allowed: [] });
      const valid = validateParameters(v.parameters);
      const checksum = sha256Hex(canonicalJson(valid));
      const published = await tx.ruleSetVersion.update({
        where: { id: v.id },
        data: { status: 'PUBLISHED', checksum, publishedAt: new Date(), publishedById: user.id },
      });
      await this.audit.record(tx, {
        action: 'ruleset.version_published',
        entityType: 'RuleSetVersion',
        entityId: v.id,
        before: { status: 'DRAFT' },
        after: { status: 'PUBLISHED', checksum },
      });
      return versionDto(published);
    });
  }
}
