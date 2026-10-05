// Расписание в жизненном цикле турнира (план §4): DRAWING → SCHEDULED — только когда расписание опубликовано.
// Области прав ковра и сессии — через турнир (вложенные маршруты, competitions/:id/...), отдельных резолверов
// не требуют; 'mat' зарегистрирован в mats.service.ts (нужен для плоского mats/:id/queue).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CompetitionExtensions } from '../../competitions';

@Injectable()
export class ScheduleLifecycle implements OnModuleInit {
  constructor(private readonly extensions: CompetitionExtensions) {}

  onModuleInit(): void {
    this.extensions.registerCheck(async ({ tx, competition, from, to }) => {
      if (from !== 'DRAWING' || to !== 'SCHEDULED') return { blocking: [] };
      const schedule = await tx.schedule.findUnique({
        where: { competitionId: competition.id },
        select: { status: true },
      });
      return { blocking: schedule?.status === 'PUBLISHED' ? [] : ['schedule_not_published'] };
    });
  }
}
