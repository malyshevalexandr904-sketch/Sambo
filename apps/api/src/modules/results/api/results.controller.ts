// Итоги (API.md; план Phase 7b, §1): итоги турнира и категории, публикация результатов категории, история
// спортсмена. Публикация — операционная команда [L] (право записи турнира у площадочного узла — отказ).
import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type {
  AthleteHistoryDto,
  CategoryResultsDto,
  CompetitionResultsDto,
  DataEnvelope,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { CategoryResultsService } from '../application/category-results.service';
import { ResultsQueriesService } from '../application/results-queries.service';

const COMP = { resolver: 'competition', param: 'id' };
const CATEGORY = { resolver: 'competitionCategory', param: 'id' };

@Controller()
export class ResultsController {
  constructor(
    private readonly queries: ResultsQueriesService,
    private readonly results: CategoryResultsService,
  ) {}

  @Get('competitions/:id/results')
  @RequirePermission('competition.view', COMP)
  async competition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CompetitionResultsDto>> {
    return ok(await this.queries.competitionResults(user, id));
  }

  @Get('categories/:id/results')
  @RequirePermission('competition.view', CATEGORY)
  async category(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<CategoryResultsDto>> {
    const dto = await this.queries.categoryResults(user, id);
    if (!dto) throw new DomainError('NOT_FOUND', { resource: 'category_results' });
    res.setHeader('ETag', etag(dto.version));
    return ok(dto);
  }

  @Post('categories/:id/results/publish')
  @RequirePermission('result.publish', CATEGORY)
  @WriteAuthority(CATEGORY)
  @HttpCode(200)
  async publish(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<CategoryResultsDto>> {
    await this.results.publish(user, id, version);
    return this.category(user, id, res);
  }

  @Get('athletes/:id/history')
  @Authenticated()
  async history(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<AthleteHistoryDto>> {
    return ok(await this.queries.history(user, id));
  }
}
