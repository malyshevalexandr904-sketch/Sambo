// Тип турнира (docs/RATING_ARCHITECTURE.md, 3.1): RATED / NON_RATED меняет только платформа
// (`competition.convert_to_rated`), с причиной и записью аудита. Организатор тип не меняет: изменение турнира поле
// не принимает. После публикации — только административной процедурой, после первого расчёта рейтинга — никак
// (это же проверяет триггер БД `competition_type_guard`). С переходом на рейтинговую систему (docs/RATED_ONLY.md) новые
// турниры только RATED; NON_RATED остаётся у прежних, и их можно только перевести в RATED.
import { Injectable } from '@nestjs/common';
import type { CompetitionRatingEnable, CompetitionType, CompetitionTypeChange } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CompetitionRatingService, type RatingPin } from '../../rating';

@Injectable()
export class CompetitionTypeService {
  constructor(
    private readonly db: PrismaService,
    private readonly rating: CompetitionRatingService,
    private readonly audit: AuditService,
  ) {}

  /** Включить рейтинг у турнира до публикации и закрепить версию правил расчёта. */
  async enableRating(competitionId: string, userId: string, input: CompetitionRatingEnable): Promise<void> {
    await this.db.tx(async (tx) => {
      const current = await this.lock(tx, competitionId);
      if (current.competitionType === 'RATED')
        throw new DomainError('COMPETITION_TYPE_UNCHANGED', { competitionType: 'RATED' });
      if (current.publishedAt) throw new DomainError('COMPETITION_TYPE_LOCKED', { reason: 'PUBLISHED' });
      await this.apply(tx, current, 'RATED', userId, input, 'competition.rating_enabled');
    });
  }

  /**
   * Административная смена типа в любую сторону — и у опубликованного турнира, пока по нему нет расчётов рейтинга.
   * Начисленный рейтинг сменой типа не отменяется: для этого — корректировки.
   */
  async changeType(competitionId: string, userId: string, input: CompetitionTypeChange): Promise<void> {
    // Все турниры рейтинговые (docs/RATED_ONLY.md): смена типа только переводит прежний турнир в рейтинговый.
    if (input.competitionType === 'NON_RATED') throw new DomainError('NON_RATED_COMPETITION_FORBIDDEN');
    await this.db.tx(async (tx) => {
      const current = await this.lock(tx, competitionId);
      if (current.competitionType === input.competitionType)
        throw new DomainError('COMPETITION_TYPE_UNCHANGED', { competitionType: input.competitionType });
      if (await this.rating.hasCalculations(tx, competitionId))
        throw new DomainError('RATING_CALCULATIONS_EXIST', { competitionId });
      // Разрешение для триггера — только в этой транзакции.
      if (current.publishedAt) await tx.$executeRaw`SELECT set_config('sde.rating_type_change', 'on', true)`;
      await this.apply(tx, current, input.competitionType, userId, input, 'competition.type_changed');
    });
  }

  private async lock(tx: Tx, competitionId: string): Promise<Locked> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return tx.competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: {
        id: true,
        competitionType: true,
        publishedAt: true,
        status: true,
        organizerOrganizationId: true,
      },
    });
  }

  private async apply(
    tx: Tx,
    current: Locked,
    to: CompetitionType,
    userId: string,
    input: Omit<RatingPin, 'reason'> & { reason: string },
    action: 'competition.rating_enabled' | 'competition.type_changed',
  ): Promise<void> {
    await tx.competition.update({
      where: { id: current.id },
      data: { competitionType: to, updatedById: userId, version: { increment: 1 } },
    });
    const ruleSet =
      to === 'RATED'
        ? await this.rating.pin(
            tx,
            current.id,
            { ruleSetId: input.ruleSetId, publicDeltas: input.publicDeltas, reason: input.reason },
            userId,
          )
        : null;
    await this.audit.record(tx, {
      action,
      entityType: 'Competition',
      entityId: current.id,
      competitionId: current.id,
      organizationId: current.organizerOrganizationId,
      before: { competitionType: current.competitionType },
      after: {
        competitionType: to,
        ...(ruleSet
          ? { ratingCalculationVersion: ruleSet.calculationVersion, publicDeltas: input.publicDeltas }
          : {}),
      },
      reason: input.reason,
      platformIntervention: true,
    });
  }
}

interface Locked {
  id: string;
  competitionType: CompetitionType;
  publishedAt: Date | null;
  status: string;
  organizerOrganizationId: string;
}
