// Профиль «я» (API.md, 3.2).
import { Injectable } from '@nestjs/common';
import {
  type Grants,
  type Me,
  type PersonDto,
  type RoleCode,
  type UpdateMeRequest,
  type UpsertMyPersonRequest,
  isRoleCode,
} from '@sde/contracts';
import { type Person, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const normalizeName = (v: string): string => v.trim().toLowerCase().replaceAll('ё', 'е');

export function personDto(p: Person): PersonDto {
  return {
    id: p.id,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName,
    birthDate: p.birthDate.toISOString().slice(0, 10),
    gender: p.gender,
    countryCode: p.countryCode,
    regionId: p.regionId,
    city: p.city,
  };
}

@Injectable()
export class MeService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<Me> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        platformRoles: { where: { revokedAt: null }, select: { role: { select: { code: true } } } },
        organizationMemberships: {
          where: { status: 'ACTIVE', OR: [{ validTo: null }, { validTo: { gte: today } }] },
          select: { organizationId: true, role: { select: { code: true } } },
        },
        competitionMemberships: {
          where: { status: 'ACTIVE' },
          select: { competitionId: true, role: { select: { code: true } } },
        },
      },
    });
    const group = (rows: { id: string; code: string }[]): Map<string, RoleCode[]> => {
      const map = new Map<string, RoleCode[]>();
      for (const r of rows) if (isRoleCode(r.code)) map.set(r.id, [...(map.get(r.id) ?? []), r.code]);
      return map;
    };
    const orgs = group(
      user.organizationMemberships.map((m) => ({ id: m.organizationId, code: m.role.code })),
    );
    const comps = group(user.competitionMemberships.map((m) => ({ id: m.competitionId, code: m.role.code })));
    const grants: Grants = {
      platform: user.platformRoles.map((p) => p.role.code).filter(isRoleCode),
      organizations: [...orgs].map(([organizationId, roles]) => ({ organizationId, roles })),
      competitions: [...comps].map(([competitionId, roles]) => ({ competitionId, roles })),
    };
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale === 'en' ? 'en' : 'ru',
      timezone: user.timezone,
      status: user.status,
      personId: user.personId,
      totpEnabled: user.totpEnabledAt !== null,
      grants,
    };
  }

  async update(userId: string, patch: UpdateMeRequest): Promise<Me> {
    await this.db.tx(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const after = await tx.user.update({
        where: { id: userId },
        data: { displayName: patch.displayName, locale: patch.locale, timezone: patch.timezone },
      });
      await this.audit.record(tx, {
        action: 'user.updated',
        entityType: 'User',
        entityId: userId,
        before: { displayName: before.displayName, locale: before.locale, timezone: before.timezone },
        after: { displayName: after.displayName, locale: after.locale, timezone: after.timezone },
      });
    });
    return this.get(userId);
  }

  async getPerson(userId: string): Promise<PersonDto | null> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { person: true } });
    return user.person ? personDto(user.person) : null;
  }

  /**
   * Создаёт или обновляет Person пользователя. Если в справочнике уже есть похожий человек
   * (то же ФИО и дата рождения) — POSSIBLE_DUPLICATE, пока пользователь не подтвердит, что это не он.
   * Привязка к существующей записи (например, созданной тренером) — с проверкой, Phase 3.
   */
  async upsertPerson(userId: string, input: UpsertMyPersonRequest): Promise<PersonDto> {
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { person: true } });
      if (!input.confirmNotDuplicate) {
        const dupes = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM person
          WHERE last_name_norm = ${normalizeName(input.lastName)} AND first_name_norm = ${normalizeName(input.firstName)}
            AND birth_date = ${toDate(input.birthDate)}::date AND deleted_at IS NULL AND merged_into_id IS NULL
            AND id IS DISTINCT FROM ${user.personId}::uuid
          LIMIT 5`;
        if (dupes.length > 0) throw new DomainError('POSSIBLE_DUPLICATE', { count: dupes.length });
      }
      const data = {
        lastName: input.lastName,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        birthDate: toDate(input.birthDate),
        gender: input.gender,
        countryCode: input.countryCode ?? null,
        regionId: input.regionId ?? null,
        city: input.city ?? null,
      };
      const person = user.person
        ? await tx.person.update({ where: { id: user.person.id }, data })
        : await tx.person.create({ data: { id: uuidv7(), ...data, createdById: userId } });
      if (!user.person) await tx.user.update({ where: { id: userId }, data: { personId: person.id } });
      await this.audit.record(tx, {
        action: 'person.upserted',
        entityType: 'Person',
        entityId: person.id,
        before: user.person ? (personDto(user.person) as unknown as Record<string, unknown>) : null,
        after: personDto(person) as unknown as Record<string, unknown>,
      });
      return personDto(person);
    });
  }
}
