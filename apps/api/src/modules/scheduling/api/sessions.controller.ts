// Сессии турнирного дня (API.md, 6.2; план Phase 6, §1). Чтение — весь персонал турнира (competition.view),
// правка — schedule.manage (TOURNAMENT_MANAGER, SECRETARY).
import { Controller, Get, Patch, Post } from '@nestjs/common';
import { type DataEnvelope, ScheduleSessionInput, ScheduleSessionPatch, type ScheduleSessionDto } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { SessionsService } from '../application/sessions.service';

const COMP = { resolver: 'competition', param: 'id' };

@Controller('competitions/:id/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @RequirePermission('competition.view', COMP)
  async list(@UuidParam('id') id: string): Promise<DataEnvelope<ScheduleSessionDto[]>> {
    return ok(await this.sessions.list(id));
  }

  @Post()
  @RequirePermission('schedule.manage', COMP)
  @WriteAuthority(COMP)
  async create(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ScheduleSessionInput) body: ScheduleSessionInput,
  ): Promise<DataEnvelope<ScheduleSessionDto>> {
    return ok(await this.sessions.create(user, id, body));
  }

  @Patch(':sessionId')
  @RequirePermission('schedule.manage', COMP)
  @WriteAuthority(COMP)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('sessionId') sessionId: string,
    @IfMatchVersion() version: number,
    @ValidBody(ScheduleSessionPatch) body: ScheduleSessionPatch,
  ): Promise<DataEnvelope<ScheduleSessionDto>> {
    return ok(await this.sessions.update(user, id, sessionId, version, body));
  }
}
