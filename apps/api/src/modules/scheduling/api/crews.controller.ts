// Судейские бригады ковра (API.md, 6.2; план Phase 6, §5; D-07). Чтение — весь персонал турнира
// (competition.view), назначение — mat_assignment.manage (TOURNAMENT_MANAGER, CHIEF_REFEREE).
import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  type CrewCandidateDto,
  type DataEnvelope,
  type MatAssignmentDto,
  MatAssignmentCopy,
  MatAssignmentPut,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { CrewsService } from '../application/crews.service';

const COMP = { resolver: 'competition', param: 'id' };

@Controller('competitions/:id')
export class CrewsController {
  constructor(private readonly crews: CrewsService) {}

  @Get('mat-assignments')
  @RequirePermission('competition.view', COMP)
  async list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<MatAssignmentDto[]>> {
    return ok(await this.crews.list(user, id));
  }

  @Get('crew-candidates')
  @RequirePermission('competition.view', COMP)
  async candidates(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CrewCandidateDto[]>> {
    return ok(await this.crews.candidates(user, id));
  }

  @Put('mat-assignments')
  @RequirePermission('mat_assignment.manage', COMP)
  @WriteAuthority(COMP)
  async put(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(MatAssignmentPut) body: MatAssignmentPut,
  ): Promise<DataEnvelope<MatAssignmentDto[]>> {
    return ok(await this.crews.put(user, id, body));
  }

  @Post('mat-assignments/copy')
  @RequirePermission('mat_assignment.manage', COMP)
  @WriteAuthority(COMP)
  async copy(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(MatAssignmentCopy) body: MatAssignmentCopy,
  ): Promise<DataEnvelope<MatAssignmentDto[]>> {
    return ok(await this.crews.copy(user, id, body));
  }
}
