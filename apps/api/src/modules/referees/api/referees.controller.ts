import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  type Page,
  RefereeCreate,
  RefereePatch,
  RefereesQuery,
  type RefereeSummary,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { RefereesService } from '../application/referees.service';

/**
 * Судьи (API.md, 4.3). Реестр общий для организаций, поэтому право проверяется в сервисе:
 * `referee.manage` в любой области (или `competition.members.manage` — для просмотра при подборе бригад).
 */
@Controller('referees')
export class RefereesController {
  constructor(private readonly referees: RefereesService) {}

  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(RefereesQuery) q: RefereesQuery,
  ): Promise<Page<RefereeSummary>> {
    return this.referees.list(user, q);
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(RefereeCreate) body: RefereeCreate,
  ): Promise<DataEnvelope<RefereeSummary>> {
    return ok(await this.referees.create(user, body));
  }

  @Patch(':id')
  @Authenticated()
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(RefereePatch) body: RefereePatch,
  ): Promise<DataEnvelope<RefereeSummary>> {
    return ok(await this.referees.update(user, id, version, body));
  }
}
