// Подписки в жизненном цикле спортсмена (Phase 8b): при слиянии дублей подписки исходного профиля переходят на
// целевой — подписавшийся продолжает получать уведомления о схватках (повтор подписки на цель не дублируется).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AthleteExtensions } from '../../athletes';

@Injectable()
export class FollowsLifecycle implements OnModuleInit {
  constructor(private readonly athletes: AthleteExtensions) {}

  onModuleInit(): void {
    this.athletes.registerMergeParticipant(async (tx, source, target) => {
      const already = await tx.follow.findMany({
        where: { targetType: 'ATHLETE', targetId: target.athleteId },
        select: { userId: true },
      });
      const have = new Set(already.map((f) => f.userId));
      const moving = await tx.follow.findMany({
        where: { targetType: 'ATHLETE', targetId: source.athleteId },
        select: { id: true, userId: true },
      });
      const duplicate = moving.filter((f) => have.has(f.userId)).map((f) => f.id);
      if (duplicate.length > 0) await tx.follow.deleteMany({ where: { id: { in: duplicate } } });
      await tx.follow.updateMany({
        where: { targetType: 'ATHLETE', targetId: source.athleteId },
        data: { targetId: target.athleteId },
      });
    });
  }
}
