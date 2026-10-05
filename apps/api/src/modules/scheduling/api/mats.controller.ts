// Ковры турнира (API.md, 6.2; план Phase 6, §1). Чтение — весь персонал турнира (competition.view), правка —
// mat.manage (TOURNAMENT_MANAGER).
import { Controller, Get, Patch, Post } from '@nestjs/common';
import { type DataEnvelope, type MatDto, MatInput, MatPatch } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { MatsService } from '../application/mats.service';

const COMP = { resolver: 'competition', param: 'id' };

@Controller('competitions/:id/mats')
export class MatsController {
  constructor(private readonly mats: MatsService) {}

  @Get()
  @RequirePermission('competition.view', COMP)
  async list(@UuidParam('id') id: string): Promise<DataEnvelope<MatDto[]>> {
    return ok(await this.mats.list(id));
  }

  @Post()
  @RequirePermission('mat.manage', COMP)
  @WriteAuthority(COMP)
  async create(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(MatInput) body: MatInput,
  ): Promise<DataEnvelope<MatDto>> {
    return ok(await this.mats.create(user, id, body));
  }

  @Patch(':matId')
  @RequirePermission('mat.manage', COMP)
  @WriteAuthority(COMP)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('matId') matId: string,
    @IfMatchVersion() version: number,
    @ValidBody(MatPatch) body: MatPatch,
  ): Promise<DataEnvelope<MatDto>> {
    return ok(await this.mats.update(user, id, matId, version, body));
  }
}
