// Завершение турнира (план Phase 7b, §1): «Идут соревнования → Завершён» — вручную, когда результаты всех категорий
// с сеткой опубликованы; категории без сетки (не разыграны) — предупреждение с подтверждением. Слияние дублей
// спортсменов: история результатов переходит к оставшемуся профилю (как и участия).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AthleteExtensions } from '../../athletes';
import { CompetitionExtensions } from '../../competitions';
import { DRAWN_STATUSES } from './results-queries.service';

const BEFORE_DRAW = ['REGISTRATION', 'CLOSED', 'WEIGH_IN', 'READY_FOR_DRAW'] as const;

@Injectable()
export class ResultsLifecycle implements OnModuleInit {
  constructor(
    private readonly extensions: CompetitionExtensions,
    private readonly athletes: AthleteExtensions,
  ) {}

  onModuleInit(): void {
    this.athletes.registerMergeParticipant(async (tx, source, target) => {
      await tx.athleteResult.updateMany({
        where: { athleteId: source.athleteId },
        data: { athleteId: target.athleteId },
      });
    });
    this.extensions.registerCheck(async ({ tx, competition, to }) => {
      if (to !== 'FINISHED') return { blocking: [] };
      const rows = await tx.competitionCategory.findMany({
        where: { competitionId: competition.id },
        select: { status: true },
      });
      const unpublished = rows.filter(
        (c) => DRAWN_STATUSES.includes(c.status) && c.status !== 'RESULTS_PUBLISHED',
      ).length;
      const undrawn = rows.filter((c) => (BEFORE_DRAW as readonly string[]).includes(c.status)).length;
      return {
        blocking: unpublished > 0 ? ['results_not_published'] : [],
        warnings: undrawn > 0 ? ['categories_without_results'] : [],
      };
    });
  }
}
