// Версии правил расчёта рейтинга (docs/RATING_ARCHITECTURE.md, 4): чтение действующей и закреплённой версии.
// Параметры проверяются схемой при каждом чтении (@sde/rating, toRuleSetInfo).
import { Injectable } from '@nestjs/common';
import { type RatingRuleSetInfo, SAMBO_ELO_CODE, toRuleSetInfo } from '@sde/rating';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Injectable()
export class RatingRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Действующая версия кода — её закрепляет новый рейтинговый турнир; null, если действующей нет. */
  async active(code: string = SAMBO_ELO_CODE): Promise<RatingRuleSetInfo | null> {
    const row = await this.prisma.ratingRuleSet.findFirst({ where: { code, status: 'ACTIVE' } });
    return row ? toRuleSetInfo(row) : null;
  }

  /** Версия по id — закреплённая турниром или указанная в расчёте схватки (любого статуса). */
  async byId(id: string): Promise<RatingRuleSetInfo | null> {
    const row = await this.prisma.ratingRuleSet.findUnique({ where: { id } });
    return row ? toRuleSetInfo(row) : null;
  }
}
