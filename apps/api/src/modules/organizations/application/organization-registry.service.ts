// Реестр организаций для регистрации по заявкам (Phase 9a): выбор организации при регистрации тренера и спортсмена,
// поиск уже зарегистрированной организации по ИНН и названию, создание организации по одобренной заявке руководителя
// и выдача подтверждённой роли участнику. Модуль organizations — владелец таблиц организации и членств.
import { Injectable } from '@nestjs/common';
import { type OnboardingOrganizationOption, type OrganizationType, type RoleCode } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { creatorRole } from '../domain/organization-rules';
import { ClosureRepository } from '../infrastructure/closure.repository';
import { OrganizationsService } from './organizations.service';

const today = (): Date => new Date(new Date().toISOString().slice(0, 10));

/** Организации, в которых работают тренеры и занимаются спортсмены: их можно выбрать в заявке. */
export const SELECTABLE_ORGANIZATION_TYPES: OrganizationType[] = ['CLUB', 'SPORTS_SCHOOL', 'OTHER'];

export interface ApprovedOrganizationInput {
  type: OrganizationType;
  name: string;
  shortName: string;
  countryCode: string;
  regionId: string | null;
  city: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  legal: { legalName: string; inn: string; ogrn: string | null; legalAddress: string } | null;
}

@Injectable()
export class OrganizationRegistryService {
  constructor(
    private readonly db: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly closure: ClosureRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Подтверждённые (активные) организации для выбора в заявке; поиск по названию. */
  async selectable(q: string | undefined, limit = 50): Promise<OnboardingOrganizationOption[]> {
    const needle = q?.toLowerCase().replaceAll('ё', 'е').trim();
    const ids = needle
      ? (
          await this.db.$queryRaw<{ id: string }[]>`
            SELECT id FROM organization
            WHERE deleted_at IS NULL AND status = 'ACTIVE'
              AND (name_norm LIKE ${'%' + needle + '%'} OR lower(short_name) LIKE ${'%' + needle + '%'})
            LIMIT 200`
        ).map((r) => r.id)
      : undefined;
    const rows = await this.db.organization.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        type: { in: SELECTABLE_ORGANIZATION_TYPES },
        id: ids ? { in: ids } : undefined,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, name: true, shortName: true, city: true, type: true },
    });
    return rows;
  }

  /** Организацию можно выбрать в заявке: существует, активна и подходящего типа. */
  async isSelectable(tx: Tx, organizationId: string): Promise<boolean> {
    const org = await tx.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { status: true, type: true },
    });
    return !!org && org.status === 'ACTIVE' && SELECTABLE_ORGANIZATION_TYPES.includes(org.type);
  }

  /** То же без транзакции: выбор тренера в форме заявки. */
  isSelectableNow(organizationId: string): Promise<boolean> {
    return this.isSelectable(this.db, organizationId);
  }

  async name(
    tx: Tx,
    organizationId: string,
  ): Promise<{ id: string; name: string; shortName: string } | null> {
    return tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, shortName: true },
    });
  }

  /**
   * Уже зарегистрированная организация с тем же ИНН или тем же названием (после нормализации — `normalized`
   * сравнивает вызывающий): кандидаты по нормализованному названию в БД (`name_norm`) и по ИНН.
   */
  async candidates(
    tx: Tx,
    query: { nameNorm: string; inn: string | null },
  ): Promise<{ id: string; name: string; inn: string | null }[]> {
    const byName = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM organization
      WHERE deleted_at IS NULL AND status <> 'ARCHIVED'
        AND (name_norm = ${query.nameNorm} OR name_norm LIKE ${'%' + query.nameNorm + '%'})
      LIMIT 50`;
    const rows = await tx.organization.findMany({
      where: {
        deletedAt: null,
        status: { not: 'ARCHIVED' },
        OR: [
          { id: { in: byName.map((r) => r.id) } },
          ...(query.inn ? [{ legalDetails: { inn: query.inn } }] : []),
        ],
      },
      select: { id: true, name: true, legalDetails: { select: { inn: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, inn: r.legalDetails?.inn ?? null }));
  }

  /**
   * Организация по одобренной заявке руководителя: сразу активна (её проверила платформа), руководитель — заявитель
   * с ролью по типу организации. Аудит и событие — в той же транзакции.
   */
  async createApproved(
    tx: Tx,
    input: ApprovedOrganizationInput,
    managerUserId: string,
    requestId: string,
  ): Promise<string> {
    if (!(await tx.country.findUnique({ where: { code: input.countryCode } })))
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'organization.countryCode', code: 'invalid_country' }],
      });
    if (input.regionId) {
      const region = await tx.region.findUnique({ where: { id: input.regionId } });
      if (!region || region.countryCode !== input.countryCode)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'organization.regionId', code: 'invalid_region' }],
        });
    }
    const id = uuidv7();
    const slug = await this.organizations.uniqueSlug(tx, undefined, input.shortName || input.name);
    await tx.organization.create({
      data: {
        id,
        type: input.type,
        parentId: null,
        name: input.name,
        shortName: input.shortName,
        slug,
        countryCode: input.countryCode,
        regionId: input.regionId,
        city: input.city,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        status: 'ACTIVE',
        createdById: managerUserId,
        legalDetails: input.legal
          ? {
              create: {
                legalName: input.legal.legalName,
                inn: input.legal.inn,
                ogrn: input.legal.ogrn,
                legalAddress: input.legal.legalAddress,
              },
            }
          : undefined,
      },
    });
    await this.closure.insertNode(tx, id, null);
    await this.audit.record(tx, {
      action: 'organization.created',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
      after: { type: input.type, status: 'ACTIVE', slug, onboardingRequestId: requestId },
    });
    await this.outbox.enqueue(tx, {
      type: 'organization.created',
      aggregate: { type: 'Organization', id },
      payload: { organizationId: id },
    });
    await this.addMember(tx, id, managerUserId, creatorRole(input.type));
    return id;
  }

  /**
   * Подтверждённая роль участника организации (одобрение заявки): действующее членство. Если такое уже есть —
   * ничего не меняется (повторная заявка того же человека не дублирует членство).
   */
  async addMember(tx: Tx, organizationId: string, userId: string, roleCode: RoleCode): Promise<void> {
    const role = await tx.role.findUniqueOrThrow({ where: { code: roleCode } });
    const existing = await tx.organizationMembership.findFirst({
      where: { organizationId, userId, roleId: role.id, status: { in: ['ACTIVE', 'INVITED'] } },
    });
    if (existing?.status === 'ACTIVE') return;
    const membershipId = existing?.id ?? uuidv7();
    if (existing) {
      await tx.organizationMembership.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', validFrom: today(), version: { increment: 1 } },
      });
    } else {
      await tx.organizationMembership.create({
        data: {
          id: membershipId,
          organizationId,
          userId,
          roleId: role.id,
          status: 'ACTIVE',
          validFrom: today(),
        },
      });
    }
    await tx.user.update({ where: { id: userId }, data: { permissionsVersion: { increment: 1 } } });
    await this.audit.record(tx, {
      action: 'organization.member_joined',
      entityType: 'OrganizationMembership',
      entityId: membershipId,
      organizationId,
      after: { status: 'ACTIVE', userId, roleCode, via: 'onboarding' },
    });
  }

  /** Пользователь — действующий участник организации с ролью. */
  async hasActiveRole(tx: Tx, organizationId: string, userId: string, roleCode: RoleCode): Promise<boolean> {
    const m = await tx.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        role: { code: roleCode },
        OR: [{ validTo: null }, { validTo: { gte: today() } }],
      },
      select: { id: true },
    });
    return m !== null;
  }

  /** Организации, где пользователь — действующий руководитель (кабинет руководителя). */
  async managedBy(userId: string): Promise<string[]> {
    const rows = await this.db.organizationMembership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        role: { code: { in: ['CLUB_MANAGER', 'FEDERATION_ADMIN', 'ORGANIZER'] } },
        OR: [{ validTo: null }, { validTo: { gte: today() } }],
      },
      select: { organizationId: true },
    });
    return [...new Set(rows.map((r) => r.organizationId))];
  }
}
