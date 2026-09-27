import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  CheckInQuery,
  type CheckInRow,
  CheckInScanRequest,
  type CheckInSummaryDto,
  CheckInUpdate,
  type DataEnvelope,
  type EntryQrDto,
  type Page,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { Idempotent } from '../../../common/http/idempotency';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { CheckInService } from '../application/checkin.service';
import { EntryQrService } from '../application/entry-qr.service';

const COMP = { resolver: 'competition', param: 'id' };

/** Прибытие (API.md, 5.5): счётчики, список с поиском, сканирование QR, отметка. */
@Controller()
export class CheckInController {
  constructor(
    private readonly checkins: CheckInService,
    private readonly qr: EntryQrService,
  ) {}

  @Get('competitions/:id/check-in/summary')
  @RequirePermission('checkin.view', COMP)
  async summary(@UuidParam('id') id: string): Promise<DataEnvelope<CheckInSummaryDto>> {
    return ok(await this.checkins.summary(id));
  }

  @Get('competitions/:id/check-in')
  @RequirePermission('checkin.view', COMP)
  list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(CheckInQuery) q: CheckInQuery,
  ): Promise<Page<CheckInRow>> {
    return this.checkins.list(user, id, q);
  }

  @Post('competitions/:id/check-in/scan')
  @RequirePermission('checkin.perform', COMP)
  @WriteAuthority(COMP)
  @Idempotent()
  @HttpCode(200)
  async scan(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CheckInScanRequest) body: CheckInScanRequest,
  ): Promise<DataEnvelope<CheckInRow>> {
    return ok(await this.checkins.scan(user, id, body.qrToken));
  }

  @Post('competitions/:id/check-in/:athleteId')
  @RequirePermission('checkin.perform', COMP)
  @WriteAuthority(COMP)
  @HttpCode(200)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('athleteId') athleteId: string,
    @IfMatchVersion() version: number,
    @ValidBody(CheckInUpdate) body: CheckInUpdate,
  ): Promise<DataEnvelope<CheckInRow>> {
    return ok(await this.checkins.update(user, id, athleteId, version, body));
  }

  /** Владелец заявки, спортсмен, представитель, персонал с `checkin.view` — проверка в сервисе. */
  @Get('entries/:id/qr')
  @Authenticated()
  async entryQr(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<EntryQrDto>> {
    return ok(await this.qr.qr(user, id));
  }
}
