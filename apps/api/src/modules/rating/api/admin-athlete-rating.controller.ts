import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  type AdminAthleteRating,
  type DataEnvelope,
  type Page,
  RatingCorrectionInput,
  type RatingCorrectionDto,
  RatingCorrectionsQuery,
  RatingRebuildApply,
  type RatingRebuildReport,
  RatingRecalculateInput,
  type RatingRecalculationReport,
  RatingStatusChange,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { RatingAdminService } from '../application/rating-admin.service';

/**
 * Корректирующие операции с рейтингом спортсмена (ТЗ 18, 65–67; docs/RATING_ARCHITECTURE.md, 8) — только платформа.
 * Организатор турнира прав PLATFORM_SCOPE не имеет: проверка на сервере, а не скрытием кнопок.
 */
@Controller('admin/athletes')
export class AdminAthleteRatingController {
  constructor(private readonly admin: RatingAdminService) {}

  @Get(':id/rating')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  async rating(@UuidParam('id') id: string): Promise<DataEnvelope<AdminAthleteRating>> {
    return ok(await this.admin.athlete(id));
  }

  @Get(':id/rating-corrections')
  @RequirePermission('competition.view_rating_audit', PLATFORM_SCOPE)
  corrections(
    @UuidParam('id') id: string,
    @ValidQuery(RatingCorrectionsQuery) q: RatingCorrectionsQuery,
  ): Promise<Page<RatingCorrectionDto>> {
    return this.admin.corrections(id, q);
  }

  /** Ручная корректировка рейтинга с причиной (ТЗ 66). */
  @Post(':id/rating-corrections')
  @RequirePermission('rating.correct', PLATFORM_SCOPE)
  async correct(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(RatingCorrectionInput) body: RatingCorrectionInput,
  ): Promise<DataEnvelope<RatingCorrectionDto>> {
    return ok(await this.admin.correct(id, body, user.id));
  }

  /** ACTIVE / FROZEN / SUSPENDED (ТЗ 67). */
  @Put(':id/rating-status')
  @RequirePermission('rating.correct', PLATFORM_SCOPE)
  async status(
    @UuidParam('id') id: string,
    @ValidBody(RatingStatusChange) body: RatingStatusChange,
  ): Promise<DataEnvelope<AdminAthleteRating>> {
    return ok(await this.admin.setStatus(id, body));
  }

  /** Отчёт о расхождении пересобранного рейтинга с текущим (ТЗ 18) — без записи. */
  @Post(':id/rebuild-rating')
  @HttpCode(200)
  @RequirePermission('competition.recalculate_rating', PLATFORM_SCOPE)
  async rebuild(@UuidParam('id') id: string): Promise<DataEnvelope<RatingRebuildReport>> {
    return ok(await this.admin.rebuildReport(id));
  }

  /** Применить пересборку — отдельное право (ТЗ 18: production rating не перезаписывается автоматически). */
  @Post(':id/rebuild-rating/apply')
  @HttpCode(200)
  @RequirePermission('rating.rebuild_apply', PLATFORM_SCOPE)
  async rebuildApply(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(RatingRebuildApply) body: RatingRebuildApply,
  ): Promise<DataEnvelope<RatingRebuildReport>> {
    return ok(await this.admin.rebuildApply(id, body, user.id));
  }
}

/** Перерасчёт рейтинга турнира (ТЗ 46) — только платформа. */
@Controller('admin/competitions')
export class AdminCompetitionRatingController {
  constructor(private readonly admin: RatingAdminService) {}

  @Post(':id/recalculate-rating')
  @HttpCode(200)
  @RequirePermission('competition.recalculate_rating', PLATFORM_SCOPE)
  async recalculate(
    @UuidParam('id') id: string,
    @ValidBody(RatingRecalculateInput) body: RatingRecalculateInput,
  ): Promise<DataEnvelope<RatingRecalculationReport>> {
    return ok(await this.admin.recalculateCompetition(id, body));
  }
}
