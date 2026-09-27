import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  MedicalClearanceCreate,
  type MedicalClearanceDto,
  MedicalClearanceRevoke,
  MedicalQuery,
  type MedicalRow,
  type Page,
  Uuid,
} from '@sde/contracts';
import { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { MedicalService } from '../application/medical.service';

const COMP = { resolver: 'competition', param: 'id' };

const AthleteClearancesQuery = z.object({ competitionId: Uuid.optional() });
type AthleteClearancesQuery = z.infer<typeof AthleteClearancesQuery>;

/**
 * Медицинский допуск (API.md, 5.7). Запись и отзыв — в контексте турнира: право `medical.record` турнирное,
 * а спортсмен должен участвовать в этом турнире.
 */
@Controller()
export class MedicalController {
  constructor(private readonly medical: MedicalService) {}

  @Get('competitions/:id/medical')
  @RequirePermission('medical.view', COMP)
  list(@UuidParam('id') id: string, @ValidQuery(MedicalQuery) q: MedicalQuery): Promise<Page<MedicalRow>> {
    return this.medical.list(id, q);
  }

  @Post('competitions/:id/medical-clearances')
  @RequirePermission('medical.record', COMP)
  @WriteAuthority(COMP)
  async record(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(MedicalClearanceCreate) body: MedicalClearanceCreate,
  ): Promise<DataEnvelope<MedicalClearanceDto>> {
    return ok(await this.medical.record(user, id, body));
  }

  @Post('competitions/:id/medical-clearances/:clearanceId/revoke')
  @RequirePermission('medical.record', COMP)
  @WriteAuthority(COMP)
  @HttpCode(200)
  async revoke(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('clearanceId') clearanceId: string,
    @ValidBody(MedicalClearanceRevoke) body: MedicalClearanceRevoke,
  ): Promise<DataEnvelope<MedicalClearanceDto>> {
    return ok(await this.medical.revoke(user, id, clearanceId, body.reason));
  }

  /** Спортсмен и представитель; врач турнира — с `?competitionId=` (проверка в сервисе). */
  @Get('athletes/:id/medical-clearances')
  @Authenticated()
  async ofAthlete(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(AthleteClearancesQuery) q: AthleteClearancesQuery,
  ): Promise<DataEnvelope<MedicalClearanceDto[]>> {
    return ok(await this.medical.ofAthlete(user, id, q.competitionId));
  }
}
