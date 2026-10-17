// Роль в кабинете (0.13.0): какие роли кабинета есть у пользователя, какая выбрана в сессии входа, переключение.
// Роли доступа (платформа, организация, турнир) группируются по ролям кабинета (`CABINET_ROLE_GRANTS`); роли-связи и
// роли-профили (спортсмен, представитель, тренер и судья без назначений) сообщают модули-владельцы через
// `registerHolder` — модуль access о спортсменах и тренерах не знает.
import { Injectable } from '@nestjs/common';
import {
  CABINET_ROLES,
  type CabinetRole,
  cabinetRoleOf,
  defaultCabinetRole,
  isCabinetRole,
} from '@sde/contracts';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GrantsService } from './grants.service';

/** Что нужно знать о пользователе, чтобы определить его роли. */
export interface CabinetUser {
  id: string;
  personId: string | null;
  permissionsVersion: number;
}

/** Есть ли у пользователя роль кабинета по связи или профилю (спортсмен, представитель, тренер, судья). */
export type CabinetRoleHolder = (user: CabinetUser) => Promise<boolean>;

/** Сохранённый выбор сессии. */
export interface SessionRoleRow {
  role: string | null;
  permissionsVersion: number;
  updatedAt: Date;
}

const asRole = (v: string | null | undefined): CabinetRole | null => (isCabinetRole(v) ? v : null);

@Injectable()
export class CabinetRolesService {
  private readonly holders = new Map<CabinetRole, CabinetRoleHolder[]>();

  constructor(
    private readonly db: PrismaService,
    private readonly grants: GrantsService,
  ) {}

  registerHolder(role: CabinetRole, holder: CabinetRoleHolder): void {
    this.holders.set(role, [...(this.holders.get(role) ?? []), holder]);
  }

  /**
   * Роли кабинета пользователя в порядке переключателя. Платформенная роль даёт роль «Администратор» и без
   * включённого TOTP (права она даст только с ним — в кабинете будет подсказка включить).
   */
  async available(user: CabinetUser): Promise<CabinetRole[]> {
    const [grants, platformAssigned] = await Promise.all([
      this.grants.forUser(user.id, user.permissionsVersion),
      this.db.platformRoleAssignment.count({ where: { userId: user.id, revokedAt: null } }),
    ]);
    const held = new Set<CabinetRole>();
    if (platformAssigned > 0) held.add('ADMIN');
    for (const r of grants.platform) held.add(cabinetRoleOf(r));
    for (const g of [...grants.organizations, ...grants.competitions]) {
      for (const r of g.roles) held.add(cabinetRoleOf(r));
    }
    const checks = [...this.holders]
      .filter(([role]) => !held.has(role))
      .map(async ([role, fns]) => ((await Promise.all(fns.map((f) => f(user)))).some(Boolean) ? role : null));
    for (const role of await Promise.all(checks)) if (role) held.add(role);
    return CABINET_ROLES.filter((r) => held.has(r));
  }

  read(sessionId: string): Promise<SessionRoleRow | null> {
    return this.db.sessionRole.findUnique({
      where: { sessionId },
      select: { role: true, permissionsVersion: true, updatedAt: true },
    });
  }

  /**
   * Роль сессии для запроса. Сохранённый выбор действует, пока не изменились права пользователя
   * (`permissionsVersion`); изменились или выбора ещё нет — выбор проверяется: прежняя роль остаётся, если она
   * есть, иначе — роль по умолчанию (последняя выбранная, иначе первая по порядку).
   * `row` — уже прочитанная строка (undefined — прочитать).
   */
  async resolve(
    user: CabinetUser & { preferredRole: string | null },
    sessionId: string,
    row?: SessionRoleRow | null,
  ): Promise<CabinetRole | null> {
    const current = row === undefined ? await this.read(sessionId) : row;
    if (current && current.permissionsVersion === user.permissionsVersion) return asRole(current.role);
    const available = await this.available(user);
    const previous = asRole(current?.role);
    const role =
      previous && available.includes(previous)
        ? previous
        : defaultCabinetRole(available, asRole(user.preferredRole));
    return this.store(user, sessionId, role, current?.updatedAt ?? null);
  }

  /**
   * Роль сессии и все роли пользователя (для `/me`). Если выбранной роли у пользователя больше нет (или не было, а
   * теперь появилась, — например, подтвердили представителя), выбирается роль по умолчанию.
   */
  async state(
    user: CabinetUser & { preferredRole: string | null; activeRole: CabinetRole | null },
    sessionId: string,
  ): Promise<{ active: CabinetRole | null; available: CabinetRole[] }> {
    const available = await this.available(user);
    const valid = user.activeRole === null ? available.length === 0 : available.includes(user.activeRole);
    if (valid) return { active: user.activeRole, available };
    const row = await this.read(sessionId);
    const role = defaultCabinetRole(available, asRole(user.preferredRole));
    return { active: await this.store(user, sessionId, role, row?.updatedAt ?? null), available };
  }

  /**
   * Переключение роли в сессии; она же становится ролью новых сессий. Роли нет у пользователя — 403.
   * Пользователь читается заново: роль могла появиться в этом же запросе (принял приглашение, создал клуб).
   */
  async select(userId: string, sessionId: string, role: CabinetRole): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, personId: true, permissionsVersion: true },
    });
    if (!(await this.available(user)).includes(role))
      throw new DomainError('FORBIDDEN', { reason: 'cabinet_role_not_held', role });
    await this.db.tx(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO session_role (session_id, user_id, role, permissions_version, updated_at)
        VALUES (${sessionId}::uuid, ${user.id}::uuid, ${role}, ${user.permissionsVersion}, clock_timestamp())
        ON CONFLICT (session_id) DO UPDATE SET
          role = EXCLUDED.role,
          permissions_version = EXCLUDED.permissions_version,
          updated_at = EXCLUDED.updated_at`;
      await tx.user.update({ where: { id: user.id }, data: { preferredRole: role } });
    });
  }

  /**
   * Переход в роль, полученную в этом же действии (принял приглашение, создал организацию): если роли почему-то нет
   * (например, организация уже приостановлена), действие не проваливается — сессия остаётся в прежней роли.
   */
  async selectIfHeld(userId: string, sessionId: string, role: CabinetRole): Promise<boolean> {
    try {
      await this.select(userId, sessionId, role);
      return true;
    } catch (e) {
      if (e instanceof DomainError) return false;
      throw e;
    }
  }

  /**
   * Запись выбора, если с момента чтения его никто не менял (`updated_at` тот же): одновременное переключение
   * пользователем выигрывает у автоматической проверки. Проиграли — действует то, что записано.
   */
  private async store(
    user: CabinetUser,
    sessionId: string,
    role: CabinetRole | null,
    expectedUpdatedAt: Date | null,
  ): Promise<CabinetRole | null> {
    const rows = await this.db.$queryRaw<{ role: string | null }[]>`
      INSERT INTO session_role (session_id, user_id, role, permissions_version, updated_at)
      VALUES (${sessionId}::uuid, ${user.id}::uuid, ${role}, ${user.permissionsVersion}, clock_timestamp())
      ON CONFLICT (session_id) DO UPDATE SET
        role = EXCLUDED.role,
        permissions_version = EXCLUDED.permissions_version,
        updated_at = EXCLUDED.updated_at
      WHERE session_role.updated_at IS NOT DISTINCT FROM ${expectedUpdatedAt}::timestamptz
      RETURNING role`;
    if (rows[0]) return asRole(rows[0].role);
    return asRole((await this.read(sessionId))?.role);
  }
}
