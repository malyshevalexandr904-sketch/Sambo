// Профиль «я» (API.md, 3.2).
import { Injectable } from '@nestjs/common';
import {
  type CabinetRole,
  type Grants,
  isCabinetRole,
  type Me,
  type PersonDto,
  type RoleCode,
  roleActiveIn,
  type UpdateMeRequest,
  type UpsertMyPersonRequest,
  isRoleCode,
} from '@sde/contracts';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CabinetRolesService } from '../../access';
import { AuditService } from '../../audit';
import { PeopleService, personAudit, personDto } from '../../people';

/**
 * Пользователь и его сессия входа: от сессии зависит выбранная роль кабинета (0.13.0). `activeRole` — уже
 * определённая для запроса (`AuthUser`); не передана (вход, подтверждение email) — определяется здесь.
 */
export interface MeRef {
  userId: string;
  sessionId: string;
  activeRole?: CabinetRole | null;
}

@Injectable()
export class MeService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    private readonly cabinetRoles: CabinetRolesService,
  ) {}

  /**
   * Профиль «я». Роли доступа — только выбранной роли кабинета (в этой сессии другие не действуют); выбранная роль
   * проверяется: если её у пользователя больше нет, выбирается роль по умолчанию.
   */
  async get({ userId, sessionId, activeRole }: MeRef): Promise<Me> {
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
    const resolved = activeRole !== undefined ? activeRole : await this.cabinetRoles.resolve(user, sessionId);
    const { active, available } = await this.cabinetRoles.state({ ...user, activeRole: resolved }, sessionId);
    const keep = (r: RoleCode): boolean => roleActiveIn(active, r);
    const inRole = <T extends { roles: RoleCode[] }>(rows: T[]): T[] =>
      rows.map((g) => ({ ...g, roles: g.roles.filter(keep) })).filter((g) => g.roles.length > 0);
    const grants: Grants = {
      platform: user.platformRoles
        .map((p) => p.role.code)
        .filter(isRoleCode)
        .filter(keep),
      organizations: inRole([...orgs].map(([organizationId, roles]) => ({ organizationId, roles }))),
      competitions: inRole([...comps].map(([competitionId, roles]) => ({ competitionId, roles }))),
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
      activeRole: active,
      availableRoles: available,
      preferredRole: isCabinetRole(user.preferredRole) ? user.preferredRole : null,
    };
  }

  /** Переключение роли кабинета в этой сессии (0.13.0). */
  async selectRole(ref: MeRef, role: CabinetRole): Promise<Me> {
    await this.cabinetRoles.select(ref.userId, ref.sessionId, role);
    return this.get({ ...ref, activeRole: role });
  }

  async update(ref: MeRef, patch: UpdateMeRequest): Promise<Me> {
    const userId = ref.userId;
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
    return this.get(ref);
  }

  async getPerson(userId: string): Promise<PersonDto | null> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { person: true } });
    return user.person ? personDto(user.person) : null;
  }

  /**
   * Создаёт или обновляет Person пользователя. Если в справочнике уже есть похожий человек
   * (то же ФИО и дата рождения) — POSSIBLE_DUPLICATE, пока пользователь не подтвердит, что это не он.
   * Привязка к записи, которую внёс тренер (законный представитель), — по приглашению (Phase 3).
   */
  async upsertPerson(userId: string, input: UpsertMyPersonRequest): Promise<PersonDto> {
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { person: true } });
      if (!input.confirmNotDuplicate) {
        const dupes = await this.people.exactMatches(tx, input, { excludePersonId: user.personId });
        if (dupes.length > 0) throw new DomainError('POSSIBLE_DUPLICATE', { count: dupes.length });
      }
      let person;
      if (user.person) {
        person = (
          await this.people.update(
            tx,
            user.person.id,
            {
              ...input,
              middleName: input.middleName ?? null,
              countryCode: input.countryCode ?? null,
              regionId: input.regionId ?? null,
              city: input.city ?? null,
            },
            '',
          )
        ).after;
      } else {
        person = await this.people.create(tx, input, userId, '');
        await tx.user.update({ where: { id: userId }, data: { personId: person.id } });
      }
      await this.audit.record(tx, {
        action: 'person.upserted',
        entityType: 'Person',
        entityId: person.id,
        before: user.person ? personAudit(user.person) : null,
        after: personAudit(person),
      });
      return personDto(person);
    });
  }
}
