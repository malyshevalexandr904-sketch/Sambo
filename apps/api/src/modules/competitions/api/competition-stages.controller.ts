import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  type CompetitionFollowDto,
  CompetitionMediaCreate,
  type CompetitionMediaDto,
  CompetitionPresentationUpdate,
  type DataEnvelope,
} from '@sde/contracts';
import { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { CompetitionStagesService } from '../application/competition-stages.service';

const FollowBody = z.object({ follow: z.boolean() });

/**
 * Стадии проведения турнира (правки 05.11.2026): оформление публичной страницы, подписка на начало регистрации,
 * медиа завершённого турнира. Права проверяет сервис: оформление и медиа — `competition.update`.
 */
@Controller('competitions')
export class CompetitionStagesController {
  constructor(private readonly stages: CompetitionStagesService) {}

  @Put(':id/presentation')
  @Authenticated()
  @HttpCode(204)
  async presentation(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionPresentationUpdate) body: CompetitionPresentationUpdate,
  ): Promise<void> {
    await this.stages.updatePresentation(user, id, body);
  }

  @Put(':id/follow')
  @Authenticated()
  async follow(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(FollowBody) body: z.infer<typeof FollowBody>,
  ): Promise<DataEnvelope<CompetitionFollowDto>> {
    return ok(await this.stages.follow(user, id, body.follow));
  }

  @Get(':id/media')
  @Authenticated()
  async media(@UuidParam('id') id: string): Promise<DataEnvelope<CompetitionMediaDto[]>> {
    return ok(await this.stages.listMedia(id));
  }

  @Post(':id/media')
  @Authenticated()
  async addMedia(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionMediaCreate) body: CompetitionMediaCreate,
  ): Promise<DataEnvelope<CompetitionMediaDto[]>> {
    return ok(await this.stages.addMedia(user, id, body));
  }

  @Delete(':id/media/:mediaId')
  @Authenticated()
  async removeMedia(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('mediaId') mediaId: string,
  ): Promise<DataEnvelope<CompetitionMediaDto[]>> {
    return ok(await this.stages.removeMedia(user, id, mediaId));
  }
}
