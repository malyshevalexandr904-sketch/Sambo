// Подписки на спортсменов (Phase 8b; API.md, 5.8): «Уведомлять о схватках» в карточке спортсмена и сразу на всех
// спортсменов заявки. Подписаться может тот, кто видит карточку; уведомления подписавшемуся уходят, пока у него есть
// доступ к спортсмену (это проверяет worker при отправке, DATABASE.md, 3.8).
import { Injectable } from '@nestjs/common';
import {
  type ApplicationFollowResultDto,
  type FollowDto,
  type FollowStateDto,
  publicName,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AthleteAccessService } from '../../athletes';
import { RegistrationAccessService } from '../../registrations';

/** Не больше подписок на пользователя (клуб с большой заявкой — сотни спортсменов). */
export const MAX_FOLLOWS = 1000;

@Injectable()
export class FollowsService {
  constructor(
    private readonly db: PrismaService,
    private readonly athletes: AthleteAccessService,
    private readonly registrations: RegistrationAccessService,
  ) {}

  private async isFollowing(userId: string, athleteId: string): Promise<boolean> {
    const row = await this.db.follow.findUnique({
      where: { userId_targetType_targetId: { userId, targetType: 'ATHLETE', targetId: athleteId } },
      select: { id: true },
    });
    return row !== null;
  }

  private async assertRoom(userId: string, adding: number): Promise<void> {
    if (adding === 0) return;
    const count = await this.db.follow.count({ where: { userId } });
    if (count + adding > MAX_FOLLOWS)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'follow', code: 'too_many_follows' }] });
  }

  async state(user: AuthUser, athleteId: string): Promise<FollowStateDto> {
    await this.athletes.assertView(user, athleteId);
    return { following: await this.isFollowing(user.id, athleteId) };
  }

  async follow(user: AuthUser, athleteId: string): Promise<FollowStateDto> {
    await this.athletes.assertView(user, athleteId);
    if (!(await this.isFollowing(user.id, athleteId))) {
      await this.assertRoom(user.id, 1);
      await this.db.follow.createMany({
        data: [{ id: uuidv7(), userId: user.id, targetType: 'ATHLETE', targetId: athleteId }],
        skipDuplicates: true,
      });
    }
    return { following: true };
  }

  /** Отписка — своя строка; о спортсмене ничего не сообщается (нет доступа — тот же ответ). */
  async unfollow(user: AuthUser, athleteId: string): Promise<FollowStateDto> {
    await this.db.follow.deleteMany({
      where: { userId: user.id, targetType: 'ATHLETE', targetId: athleteId },
    });
    return { following: false };
  }

  /**
   * Все спортсмены одобренных участий заявки — подписать или отписать разом. Только клуб заявки (владелец):
   * персоналу турнира без клуба — 403, остальным — 404.
   */
  async followApplication(
    user: AuthUser,
    applicationId: string,
    follow: boolean,
  ): Promise<ApplicationFollowResultDto> {
    const ctx = await this.registrations.applicationContext(applicationId);
    await this.registrations.assertOwner(user, ctx);
    const entries = await this.db.entry.findMany({
      where: { applicationId, status: 'APPROVED' },
      select: { athleteId: true },
    });
    const athleteIds = [...new Set(entries.map((e) => e.athleteId))];
    if (follow) {
      const existing = await this.db.follow.findMany({
        where: { userId: user.id, targetType: 'ATHLETE', targetId: { in: athleteIds } },
        select: { targetId: true },
      });
      const have = new Set(existing.map((e) => e.targetId));
      const missing = athleteIds.filter((id) => !have.has(id));
      await this.assertRoom(user.id, missing.length);
      await this.db.follow.createMany({
        data: missing.map((targetId) => ({
          id: uuidv7(),
          userId: user.id,
          targetType: 'ATHLETE' as const,
          targetId,
        })),
        skipDuplicates: true,
      });
    } else {
      await this.db.follow.deleteMany({
        where: { userId: user.id, targetType: 'ATHLETE', targetId: { in: athleteIds } },
      });
    }
    const following = await this.db.follow.count({
      where: { userId: user.id, targetType: 'ATHLETE', targetId: { in: athleteIds } },
    });
    return { following, total: athleteIds.length };
  }

  /**
   * Мои подписки (новые сверху): «Фамилия И.» — пока пользователь видит карточку спортсмена; потерял доступ — без
   * имени (подписку можно снять).
   */
  async mine(user: AuthUser): Promise<FollowDto[]> {
    const rows = await this.db.follow.findMany({
      where: { userId: user.id, targetType: 'ATHLETE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const profiles = rows.length
      ? await this.db.athleteProfile.findMany({
          where: { id: { in: rows.map((r) => r.targetId) } },
          select: { id: true, person: { select: { lastName: true, firstName: true } } },
        })
      : [];
    const names = new Map(profiles.map((p) => [p.id, publicName(p.person.lastName, p.person.firstName)]));
    const out: FollowDto[] = [];
    for (const r of rows) {
      if (!names.has(r.targetId)) continue;
      out.push({
        athleteId: r.targetId,
        name: (await this.sees(user, r.targetId)) ? (names.get(r.targetId) as string) : null,
        createdAt: r.createdAt.toISOString(),
      });
    }
    return out;
  }

  private async sees(user: AuthUser, athleteId: string): Promise<boolean> {
    try {
      await this.athletes.assertView(user, athleteId);
      return true;
    } catch (e) {
      if (e instanceof DomainError) return false;
      throw e;
    }
  }
}
