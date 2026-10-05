// Расписание турнира (API.md, 6.2; план Phase 6, §2–§4, §6). Чтение — весь персонал турнира (competition.view),
// генерация и правка — schedule.manage (TOURNAMENT_MANAGER, SECRETARY), публикация — schedule.publish
// (TOURNAMENT_MANAGER). Очередь ковра («Ковры») — плоский маршрут по ковру.
import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  type MatQueueDto,
  type ScheduleDto,
  ScheduleGenerate,
  ScheduleItemsPatch,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { ScheduleQueriesService } from '../application/schedule-queries.service';
import { ScheduleService } from '../application/schedule.service';

const COMP = { resolver: 'competition', param: 'id' };
const MAT = { resolver: 'mat', param: 'id' };

@Controller()
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly queries: ScheduleQueriesService,
  ) {}

  @Get('competitions/:id/schedule')
  @RequirePermission('competition.view', COMP)
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<ScheduleDto>> {
    return ok(await this.queries.get(user, id));
  }

  @Post('competitions/:id/schedule/generate')
  @RequirePermission('schedule.manage', COMP)
  @WriteAuthority(COMP)
  async generate(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ScheduleGenerate) body: ScheduleGenerate,
  ): Promise<DataEnvelope<ScheduleDto>> {
    return ok(await this.schedule.generate(user, id, body));
  }

  @Patch('competitions/:id/schedule/items')
  @RequirePermission('schedule.manage', COMP)
  @WriteAuthority(COMP)
  async patchItems(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(ScheduleItemsPatch) body: ScheduleItemsPatch,
  ): Promise<DataEnvelope<ScheduleDto>> {
    return ok(await this.schedule.patchItems(user, id, version, body));
  }

  @Post('competitions/:id/schedule/publish')
  @RequirePermission('schedule.publish', COMP)
  @WriteAuthority(COMP)
  @HttpCode(200)
  async publish(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<ScheduleDto>> {
    return ok(await this.schedule.publish(user, id, version));
  }

  @Get('mats/:id/queue')
  @RequirePermission('competition.view', MAT)
  async matQueue(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<MatQueueDto>> {
    return ok(await this.queries.matQueue(user, id));
  }
}
