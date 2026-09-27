import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  type Page,
  type ScaleDto,
  ScaleInput,
  ScalePatch,
  type WeighInAttemptDto,
  WeighInCreate,
  type WeighInOutcomeDto,
  WeighInQuery,
  type WeighInRow,
  type WeighInSettingsDto,
  type WeighInWindowDto,
  WeighInWindowInput,
  WeighInWindowPatch,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { Idempotent } from '../../../common/http/idempotency';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { WeighInSetupService } from '../application/weighin-setup.service';
import { WeighInService } from '../application/weighin.service';

const COMP = { resolver: 'competition', param: 'id' };
const ENTRY = { resolver: 'entry', param: 'id' };

/** Весы и окна взвешивания турнира (API.md, 5.6): просмотр — `weighin.view`, настройка — `weighin.manage`. */
@Controller('competitions/:id')
export class WeighInSetupController {
  constructor(private readonly setup: WeighInSetupService) {}

  @Get('scales')
  @RequirePermission('weighin.view', COMP)
  async scales(@UuidParam('id') id: string): Promise<DataEnvelope<ScaleDto[]>> {
    return ok(await this.setup.scales(id));
  }

  @Post('scales')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  async createScale(
    @UuidParam('id') id: string,
    @ValidBody(ScaleInput) body: ScaleInput,
  ): Promise<DataEnvelope<ScaleDto[]>> {
    return ok(await this.setup.createScale(id, body));
  }

  @Patch('scales/:scaleId')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  async updateScale(
    @UuidParam('id') id: string,
    @UuidParam('scaleId') scaleId: string,
    @ValidBody(ScalePatch) body: ScalePatch,
  ): Promise<DataEnvelope<ScaleDto[]>> {
    return ok(await this.setup.updateScale(id, scaleId, body));
  }

  @Delete('scales/:scaleId')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  @HttpCode(204)
  async deleteScale(@UuidParam('id') id: string, @UuidParam('scaleId') scaleId: string): Promise<void> {
    await this.setup.deleteScale(id, scaleId);
  }

  @Get('weigh-in-windows')
  @RequirePermission('weighin.view', COMP)
  async windows(@UuidParam('id') id: string): Promise<DataEnvelope<WeighInWindowDto[]>> {
    return ok(await this.setup.windows(id));
  }

  @Post('weigh-in-windows')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  async createWindow(
    @UuidParam('id') id: string,
    @ValidBody(WeighInWindowInput) body: WeighInWindowInput,
  ): Promise<DataEnvelope<WeighInWindowDto[]>> {
    return ok(await this.setup.createWindow(id, body));
  }

  @Patch('weigh-in-windows/:windowId')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  async updateWindow(
    @UuidParam('id') id: string,
    @UuidParam('windowId') windowId: string,
    @ValidBody(WeighInWindowPatch) body: WeighInWindowPatch,
  ): Promise<DataEnvelope<WeighInWindowDto[]>> {
    return ok(await this.setup.updateWindow(id, windowId, body));
  }

  @Delete('weigh-in-windows/:windowId')
  @RequirePermission('weighin.manage', COMP)
  @WriteAuthority(COMP)
  @HttpCode(204)
  async deleteWindow(@UuidParam('id') id: string, @UuidParam('windowId') windowId: string): Promise<void> {
    await this.setup.deleteWindow(id, windowId);
  }
}

/** Взвешивание (API.md, 5.6): экран взвешивания, запись попытки, история. */
@Controller()
export class WeighInController {
  constructor(private readonly weighins: WeighInService) {}

  @Get('competitions/:id/weigh-in/settings')
  @RequirePermission('weighin.view', COMP)
  async settings(@UuidParam('id') id: string): Promise<DataEnvelope<WeighInSettingsDto>> {
    return ok(await this.weighins.settings(id));
  }

  @Get('competitions/:id/weigh-in')
  @RequirePermission('weighin.view', COMP)
  list(@UuidParam('id') id: string, @ValidQuery(WeighInQuery) q: WeighInQuery): Promise<Page<WeighInRow>> {
    return this.weighins.list(id, q);
  }

  @Post('entries/:id/weigh-ins')
  @RequirePermission('weighin.record', ENTRY)
  @WriteAuthority(ENTRY)
  @Idempotent()
  async record(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(WeighInCreate) body: WeighInCreate,
  ): Promise<DataEnvelope<WeighInOutcomeDto>> {
    return ok(await this.weighins.record(user, id, body));
  }

  /** Персонал с `weighin.view` и владелец заявки — проверка в сервисе. */
  @Get('entries/:id/weigh-ins')
  @Authenticated()
  async history(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<WeighInAttemptDto[]>> {
    return ok(await this.weighins.history(user, id));
  }
}
