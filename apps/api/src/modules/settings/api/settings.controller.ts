import { Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  type EmailDeliveryStatus,
  PutSettingRequest,
  type SystemSettingDto,
} from '@sde/contracts';
import type { Env } from '@sde/server-kit';
import { RequestContextStore } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { ValidBody } from '../../../common/validation/zod.pipe';
import { ENV } from '../../../config/config.module';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { SettingsService } from '../application/settings.service';

@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Куда уходят письма (0.13.0): предупреждение администратору, если сервер пишет их во внутренний ящик Mailpit
   * (установка по умолчанию) или в журнал — подтверждение email и письма-уведомления пользователям не дойдут.
   */
  @Get('email-delivery')
  @RequirePermission('platform.settings.manage', PLATFORM_SCOPE)
  emailDelivery(): DataEnvelope<EmailDeliveryStatus> {
    const host = this.env.EMAIL_PROVIDER === 'smtp' ? (this.env.SMTP_HOST ?? null) : null;
    const internal =
      this.env.EMAIL_PROVIDER === 'log' || ['mailpit', 'localhost', '127.0.0.1', '::1'].includes(host ?? '');
    return ok({
      mode: this.env.EMAIL_PROVIDER === 'log' ? 'LOG' : 'SMTP',
      internal,
      host,
      from: this.env.EMAIL_FROM,
    });
  }

  @Get()
  @RequirePermission('platform.settings.manage', PLATFORM_SCOPE)
  async list(): Promise<DataEnvelope<SystemSettingDto[]>> {
    return ok(await this.settings.list());
  }

  @Put(':key')
  @RequirePermission('platform.settings.manage', PLATFORM_SCOPE)
  async put(
    @Param('key') key: string,
    @ValidBody(PutSettingRequest) body: { value: unknown },
  ): Promise<DataEnvelope<SystemSettingDto>> {
    const user = RequestContextStore.current().user;
    return ok(await this.settings.put(key, body.value, user?.id ?? ''));
  }
}
