// Рейтинг турнира (docs/RATING_ARCHITECTURE.md, 3.1, 4): закрепление версии правил расчёта за рейтинговым турниром.
// Тип турнира меняет модуль турниров; здесь — только настройки рейтинга, в транзакции его команды.
import { Injectable } from '@nestjs/common';
import type { CompetitionRatingDto, RatingRuleSetSummary } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { type RatingRuleSetInfo, SAMBO_ELO_CODE, toRuleSetInfo } from '@sde/rating';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface RatingPin {
  ruleSetId?: string | undefined;
  publicDeltas: boolean;
  reason: string | null;
}

@Injectable()
export class CompetitionRatingService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Закрепить за турниром версию правил: указанную (только действующую) или действующую версию sambo-elo.
   * Повторное включение (после смены типа) заменяет закреплённую версию: расчётов по турниру ещё нет.
   */
  async pin(tx: Tx, competitionId: string, pin: RatingPin, userId: string): Promise<RatingRuleSetInfo> {
    const row = await tx.ratingRuleSet.findFirst({
      where: pin.ruleSetId
        ? { id: pin.ruleSetId, status: 'ACTIVE' }
        : { code: SAMBO_ELO_CODE, status: 'ACTIVE' },
    });
    if (!row) throw new DomainError('RATING_RULE_SET_UNAVAILABLE', { ruleSetId: pin.ruleSetId ?? null });
    const ruleSet = toRuleSetInfo(row);
    const data = {
      ruleSetId: ruleSet.id,
      publicDeltas: pin.publicDeltas,
      enabledById: userId,
      enabledAt: new Date(),
      reason: pin.reason,
    };
    await tx.competitionRatingConfig.upsert({
      where: { competitionId },
      create: { competitionId, ...data },
      update: data,
    });
    return ruleSet;
  }

  /**
   * Рейтинг спортсменов для посева жеребьёвки (ТЗ 27): текущий рейтинг, у кого его ещё нет — начальный из версии
   * правил турнира (действующей, если турнир не рейтинговый). Правил нет — у таких спортсменов рейтинга нет.
   */
  async seedRatings(
    tx: Tx | null,
    competitionId: string,
    athleteIds: string[],
  ): Promise<Map<string, number>> {
    const db = tx ?? this.db;
    const result = new Map<string, number>();
    if (athleteIds.length === 0) return result;
    const rows = await db.athleteRating.findMany({
      where: { athleteId: { in: athleteIds } },
      select: { athleteId: true, rating: true },
    });
    for (const r of rows) result.set(r.athleteId, r.rating);
    if (result.size === athleteIds.length) return result;
    const pinned = await db.competitionRatingConfig.findUnique({
      where: { competitionId },
      select: { ruleSet: true },
    });
    const row =
      pinned?.ruleSet ??
      (await db.ratingRuleSet.findFirst({ where: { code: SAMBO_ELO_CODE, status: 'ACTIVE' } }));
    if (!row) return result;
    const initial = toRuleSetInfo(row).rules.initialRating;
    for (const id of athleteIds) if (!result.has(id)) result.set(id, initial);
    return result;
  }

  /** Есть ли расчёты рейтинга по турниру (любого статуса) — после них тип турнира не меняется. */
  async hasCalculations(tx: Tx, competitionId: string): Promise<boolean> {
    return (await tx.ratingCalculation.count({ where: { competitionId }, take: 1 })) > 0;
  }

  /** Настройки рейтинга турнира для карточки; у безрейтингового — null. */
  async forCompetition(competitionId: string): Promise<CompetitionRatingDto | null> {
    const config = await this.db.competitionRatingConfig.findUnique({
      where: { competitionId },
      include: { ruleSet: true },
    });
    if (!config) return null;
    const ruleSet = toRuleSetInfo(config.ruleSet);
    return {
      ruleSet: {
        id: ruleSet.id,
        code: ruleSet.code,
        version: ruleSet.version,
        name: ruleSet.name,
        calculationVersion: ruleSet.calculationVersion,
      },
      publicDeltas: config.publicDeltas,
      enabledAt: config.enabledAt.toISOString(),
    };
  }

  /** Действующая версия правил — её закрепит новый рейтинговый турнир (экран создания, только чтение). */
  async activeSummary(): Promise<RatingRuleSetSummary> {
    const row = await this.db.ratingRuleSet.findFirst({ where: { code: SAMBO_ELO_CODE, status: 'ACTIVE' } });
    if (!row) throw new DomainError('RATING_RULE_SET_UNAVAILABLE', { ruleSetId: null });
    const { rules, ...info } = toRuleSetInfo(row);
    return {
      id: info.id,
      code: info.code,
      version: info.version,
      name: info.name,
      calculationVersion: info.calculationVersion,
      activeFrom: row.activeFrom?.toISOString() ?? null,
      rules: {
        initialRating: rules.initialRating,
        kFactorRules: rules.kFactorRules,
        scoreRules: rules.scoreRules,
        levelRules: rules.levelRules,
        roundingRule: rules.roundingRule,
      },
    };
  }
}
