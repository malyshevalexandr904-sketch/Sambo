import { Controller, Delete, Get, HttpCode, Put, Res } from '@nestjs/common';
import {
  type DataEnvelope,
  type PushConfigDto,
  type PushDeviceDto,
  PushSubscriptionDelete,
  PushSubscriptionPut,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { PushService } from '../application/push.service';

/** Устройства Web Push пользователя (Phase 8b; API.md, 5.8): только свои — права не нужны. */
@Controller('me/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  @Authenticated()
  config(): DataEnvelope<PushConfigDto> {
    return ok(this.push.config());
  }

  @Get('subscriptions')
  @Authenticated()
  async devices(@CurrentUser() user: AuthUser): Promise<DataEnvelope<PushDeviceDto[]>> {
    return ok(await this.push.devices(user));
  }

  /** Подписать это устройство; `onlyIfMine` и устройство чужое — 204 без изменений. */
  @Put('subscriptions')
  @Authenticated()
  async subscribe(
    @CurrentUser() user: AuthUser,
    @ValidBody(PushSubscriptionPut) body: PushSubscriptionPut,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<PushDeviceDto> | undefined> {
    const device = await this.push.subscribe(user, body);
    if (device) return ok(device);
    res.status(204);
    return undefined;
  }

  @Delete('subscriptions')
  @Authenticated()
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @ValidBody(PushSubscriptionDelete) body: PushSubscriptionDelete,
  ): Promise<void> {
    await this.push.unsubscribe(user, body.endpoint);
  }

  @Delete('subscriptions/:id')
  @Authenticated()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    await this.push.remove(user, id);
  }
}
