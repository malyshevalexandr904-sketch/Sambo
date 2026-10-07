// Бригада ковра в правах (PERMISSIONS.md, 5; план Phase 7a, §4): политики MAT_ASSIGNED (◐ у судьи — вызов, старт,
// время, оценки, результат) и MAT_CHIEF (◐ у судьи — подтверждение результата). Судья действует только на ковре
// схватки (фактическом после старта, иначе по расписанию) в сессии её места в расписании; главный судья и
// руководитель турнира — по прямым правам матрицы. Модуль расписания — владелец бригад и мест в расписании.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MatCrewRole, PermissionCode } from '@sde/contracts';
import type { Session } from '@sde/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';

/** Ресурс политик бригады — схватка. */
export interface MatchResource {
  matchId: string;
}

const MAT_ASSIGNED: readonly PermissionCode[] = [
  'match.update',
  'match.start',
  'match.finish',
  'scoring.create',
  'scoring.update',
];

const matchIdOf = (resource: unknown): string | null => {
  const id = (resource as Partial<MatchResource> | undefined)?.matchId;
  return typeof id === 'string' ? id : null;
};

@Injectable()
export class CrewAccessService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit(): void {
    for (const permission of MAT_ASSIGNED)
      this.policy.registerPolicy(permission, (user, _scope, resource) =>
        this.assigned(user.id, matchIdOf(resource), null),
      );
    this.policy.registerPolicy('result.confirm', (user, _scope, resource) =>
      this.assigned(user.id, matchIdOf(resource), 'MAT_CHIEF'),
    );
  }

  /**
   * Пользователь в бригаде ковра схватки в сессии её места в расписании; `role` — конкретная должность
   * (MAT_CHIEF — руководитель ковра). Схватка без места в расписании бригады не имеет.
   */
  async assigned(userId: string, matchId: string | null, role: MatCrewRole | null): Promise<boolean> {
    if (!matchId) return false;
    const rows = await this.db.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n
        FROM "match" m
        JOIN "match_schedule" s ON s.match_id = m.id
        JOIN "mat_assignment" a ON a.session_id = s.session_id AND a.mat_id = COALESCE(m.mat_id, s.mat_id)
       WHERE m.id = ${matchId}::uuid
         AND a.user_id = ${userId}::uuid
         AND (${role}::text IS NULL OR a.role::text = ${role}::text)
       LIMIT 1`;
    return rows.length > 0;
  }

  /** Должности пользователя по коврам сессии. */
  async rolesInSession(userId: string, sessionId: string): Promise<Map<string, MatCrewRole[]>> {
    const rows = await this.db.matAssignment.findMany({
      where: { sessionId, userId },
      select: { matId: true, role: true },
    });
    const byMat = new Map<string, MatCrewRole[]>();
    for (const r of rows) byMat.set(r.matId, [...(byMat.get(r.matId) ?? []), r.role]);
    return byMat;
  }

  /** Ковры и сессии, где пользователь — руководитель ковра (подтверждает результаты своего ковра). */
  async chiefPosts(userId: string, competitionId: string): Promise<{ sessionId: string; matId: string }[]> {
    return this.db.matAssignment.findMany({
      where: { competitionId, userId, role: 'MAT_CHIEF' },
      select: { sessionId: true, matId: true },
    });
  }

  /**
   * Текущая сессия турнира: идёт сейчас; иначе ближайшая следующая; иначе последняя прошедшая (после окончания
   * дня бригада ещё подтверждает результаты).
   */
  async currentSession(competitionId: string, now = new Date()): Promise<Session | null> {
    const sessions = await this.db.session.findMany({
      where: { competitionId },
      orderBy: { startsAt: 'asc' },
    });
    return (
      sessions.find((s) => s.startsAt <= now && now < s.endsAt) ??
      sessions.find((s) => s.startsAt > now) ??
      sessions[sessions.length - 1] ??
      null
    );
  }

  async sessions(competitionId: string): Promise<Session[]> {
    return this.db.session.findMany({ where: { competitionId }, orderBy: { startsAt: 'asc' } });
  }
}
