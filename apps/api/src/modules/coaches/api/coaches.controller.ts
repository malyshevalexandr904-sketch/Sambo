import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  CoachCreate,
  CoachesQuery,
  CoachMembershipEnd,
  CoachPatch,
  type CoachSummary,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { CoachesService } from '../application/coaches.service';

const COACH = { resolver: 'coach', param: 'id' };

/** Тренеры (API.md, 4.3). Организация из тела проверяется в сервисе: право `coach.manage` в ней. */
@Controller('coaches')
export class CoachesController {
  constructor(private readonly coaches: CoachesService) {}

  /** Тренеры организаций пользователя (и дочерних — для федерации). */
  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(CoachesQuery) q: CoachesQuery,
  ): Promise<Page<CoachSummary>> {
    return this.coaches.list(user, q);
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(CoachCreate) body: CoachCreate,
  ): Promise<DataEnvelope<CoachSummary>> {
    return ok(await this.coaches.create(user, body));
  }

  @Patch(':id')
  @RequirePermission('coach.manage', COACH)
  async update(
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(CoachPatch) body: CoachPatch,
  ): Promise<DataEnvelope<CoachSummary>> {
    return ok(await this.coaches.update(id, version, body));
  }

  @Post(':id/end-membership')
  @RequirePermission('coach.manage', COACH)
  @HttpCode(200)
  async endMembership(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CoachMembershipEnd) body: CoachMembershipEnd,
  ): Promise<DataEnvelope<CoachSummary>> {
    return ok(await this.coaches.endMembership(user, id, body.organizationId));
  }
}
