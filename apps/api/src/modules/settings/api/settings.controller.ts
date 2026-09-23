import { Controller, Get, Param, Put } from '@nestjs/common';
import { type DataEnvelope, PutSettingRequest, type SystemSettingDto } from '@sde/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { ValidBody } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { SettingsService } from '../application/settings.service';

@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
