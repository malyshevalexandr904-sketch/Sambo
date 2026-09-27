import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ADMISSION_CHECK_KINDS,
  type AdmissionCheckKind,
  type AdmissionDto,
  AdmissionQuery,
  type AdmissionRow,
  AdmissionWaiveRequest,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { AdmissionService } from '../application/admission.service';

const COMP = { resolver: 'competition', param: 'id' };
const ENTRY = { resolver: 'entry', param: 'id' };

/** Допуск (API.md, 5.4): мандатная комиссия турнира и допуск отдельного участия. */
@Controller()
export class AdmissionController {
  constructor(private readonly admission: AdmissionService) {}

  @Get('competitions/:id/admission')
  @RequirePermission('admission.view', COMP)
  list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(AdmissionQuery) q: AdmissionQuery,
  ): Promise<Page<AdmissionRow>> {
    return this.admission.list(user, id, q);
  }

  /** Персонал с `admission.view`, владелец заявки, спортсмен и представитель — проверка в сервисе. */
  @Get('entries/:id/admission')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<AdmissionDto>> {
    return ok(await this.admission.get(user, id));
  }

  @Post('entries/:id/admission/checks/:kind/waive')
  @RequirePermission('admission.override', ENTRY)
  @WriteAuthority(ENTRY)
  @HttpCode(200)
  async waive(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidParam('kind', z.enum(ADMISSION_CHECK_KINDS)) kind: AdmissionCheckKind,
    @ValidBody(AdmissionWaiveRequest) body: AdmissionWaiveRequest,
  ): Promise<DataEnvelope<AdmissionDto>> {
    return ok(await this.admission.waive(user, id, kind, body.reason));
  }

  @Post('entries/:id/admission/recompute')
  @RequirePermission('admission.view', ENTRY)
  @HttpCode(200)
  async recompute(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<AdmissionDto>> {
    return ok(await this.admission.recomputeEntry(user, id));
  }
}
