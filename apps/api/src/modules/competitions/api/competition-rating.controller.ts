import { Controller, HttpCode, Post, Res } from '@nestjs/common';
import {
  type Competition,
  CompetitionRatingEnable,
  CompetitionTypeChange,
  type DataEnvelope,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { etag, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { CompetitionTypeService } from '../application/competition-type.service';
import { CompetitionsService } from '../application/competitions.service';

/** Рейтинговый турнир — решение платформы (docs/RATING_ARCHITECTURE.md, 3.1, 8). */
@Controller('admin/competitions')
export class CompetitionRatingController {
  constructor(
    private readonly types: CompetitionTypeService,
    private readonly competitions: CompetitionsService,
  ) {}

  /** Включить рейтинг у неопубликованного турнира. */
  @Post(':id/rating')
  @HttpCode(200)
  @RequirePermission('competition.convert_to_rated', PLATFORM_SCOPE)
  async enable(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionRatingEnable) body: CompetitionRatingEnable,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    await this.types.enableRating(id, user.id, body);
    return this.send(res, await this.competitions.get(user, id));
  }

  /** Административная смена типа турнира (и опубликованного), пока по нему нет расчётов рейтинга. */
  @Post(':id/rating-type-change')
  @HttpCode(200)
  @RequirePermission('competition.convert_to_rated', PLATFORM_SCOPE)
  async changeType(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionTypeChange) body: CompetitionTypeChange,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    await this.types.changeType(id, user.id, body);
    return this.send(res, await this.competitions.get(user, id));
  }

  private send(res: Response, c: Competition): DataEnvelope<Competition> {
    res.setHeader('ETag', etag(c.version));
    return ok(c);
  }
}
