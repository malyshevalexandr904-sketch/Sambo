// Категории в жизненном цикле турнира (ARCHITECTURE.md, 16.1): условия переходов турнира по категориям и
// эффекты — закрытие и повторное открытие регистрации в категориях.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma, Tx } from '@sde/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CompetitionExtensions, type TransitionContext } from '../../competitions';

const FINAL = ['RESULTS_PUBLISHED', 'MERGED', 'CANCELLED'] as const;

@Injectable()
export class CategoryLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly competitions: CompetitionExtensions,
  ) {}

  onModuleInit(): void {
    this.competitions.registerCheck((ctx) => this.check(ctx));
    this.competitions.registerEffect((ctx) => this.effect(ctx));
    this.competitions.registerCounters(async (tx, competitionId) => ({
      categories: await this.count(tx, competitionId, { status: { notIn: ['MERGED', 'CANCELLED'] } }),
    }));
  }

  private count(
    tx: Tx | null,
    competitionId: string,
    where: Prisma.CompetitionCategoryWhereInput,
  ): Promise<number> {
    return (tx ?? this.db).competitionCategory.count({ where: { competitionId, ...where } });
  }

  private async check(ctx: TransitionContext): Promise<{ blocking: string[] }> {
    const { tx, competition, from, to } = ctx;
    const id = competition.id;
    const blocking: string[] = [];
    if (from === 'DRAFT' && to === 'REGISTRATION_OPEN') {
      if ((await this.count(tx, id, { status: { notIn: ['MERGED', 'CANCELLED'] } })) === 0)
        blocking.push('no_categories');
    }
    if (from === 'CHECK_IN' && to === 'DRAWING') {
      if ((await this.count(tx, id, { status: 'READY_FOR_DRAW' })) === 0)
        blocking.push('no_categories_ready_for_draw');
    }
    if (from === 'DRAWING' && to === 'SCHEDULED') {
      if ((await this.count(tx, id, { status: 'DRAWN' })) === 0) blocking.push('no_categories_drawn');
    }
    if (from === 'IN_PROGRESS' && to === 'FINISHED') {
      if ((await this.count(tx, id, { status: { notIn: [...FINAL] } })) > 0)
        blocking.push('categories_not_finished');
    }
    return { blocking };
  }

  /**
   * Регистрация турнира закрыта — закрыта и в категориях; продлена — категории, закрытые вместе с турниром,
   * снова принимают заявки. Начало мандатной комиссии открывает взвешивание в закрытых категориях.
   */
  private async effect(ctx: TransitionContext): Promise<void> {
    const { tx, competition, from, to } = ctx;
    if (from === 'REGISTRATION_OPEN' && to === 'REGISTRATION_CLOSED')
      await tx.competitionCategory.updateMany({
        where: { competitionId: competition.id, status: 'REGISTRATION' },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
    if (from === 'REGISTRATION_CLOSED' && to === 'REGISTRATION_OPEN')
      await tx.competitionCategory.updateMany({
        where: { competitionId: competition.id, status: 'CLOSED' },
        data: { status: 'REGISTRATION', version: { increment: 1 } },
      });
    if (from === 'REGISTRATION_CLOSED' && to === 'CHECK_IN')
      await tx.competitionCategory.updateMany({
        where: { competitionId: competition.id, status: 'CLOSED' },
        data: { status: 'WEIGH_IN', version: { increment: 1 } },
      });
  }
}
