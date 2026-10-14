import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ApplicationFollow,
  type ApplicationFollowResultDto,
  type DataEnvelope,
  type FollowDto,
  type FollowStateDto,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { FollowsService } from '../application/follows.service';

/**
 * Подписки на спортсменов (Phase 8b; API.md, 5.8). Права не нужны: подписка — своя строка, доступ к спортсмену
 * (карточка) и к заявке (клуб) проверяет сервис.
 */
@Controller()
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get('athletes/:id/follow')
  @Authenticated()
  async state(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<FollowStateDto>> {
    return ok(await this.follows.state(user, id));
  }

  @Put('athletes/:id/follow')
  @Authenticated()
  async follow(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<FollowStateDto>> {
    return ok(await this.follows.follow(user, id));
  }

  @Delete('athletes/:id/follow')
  @Authenticated()
  async unfollow(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<FollowStateDto>> {
    return ok(await this.follows.unfollow(user, id));
  }

  /** Подписать или отписать всех спортсменов заявки: состояние, а не новый ресурс — 200. */
  @Post('applications/:id/follow')
  @Authenticated()
  @HttpCode(200)
  async followApplication(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ApplicationFollow) body: ApplicationFollow,
  ): Promise<DataEnvelope<ApplicationFollowResultDto>> {
    return ok(await this.follows.followApplication(user, id, body.follow));
  }

  @Get('me/follows')
  @Authenticated()
  async mine(@CurrentUser() user: AuthUser): Promise<DataEnvelope<FollowDto[]>> {
    return ok(await this.follows.mine(user));
  }
}
