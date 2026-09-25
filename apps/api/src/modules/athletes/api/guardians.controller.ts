import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  GuardianCreate,
  GuardianInvite,
  type GuardianSummary,
  GuardianVerify,
  type MyAthlete,
  ReasonRequest,
  TokenRequest,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { GuardiansService } from '../application/guardians.service';

const ATHLETE = { resolver: 'athlete', param: 'id' };

/** Законные представители (API.md, 4.2): тренеру — по политике COACH_OWN, клубу — в своей организации. */
@Controller('athletes/:id/guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Post()
  @RequirePermission('guardian.manage', ATHLETE)
  async add(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(GuardianCreate) body: GuardianCreate,
  ): Promise<DataEnvelope<GuardianSummary>> {
    return ok(await this.guardians.add(user, id, body, RequestContextStore.current().locale));
  }

  @Post(':guardianId/verify')
  @RequirePermission('guardian.manage', ATHLETE)
  @HttpCode(200)
  async verify(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('guardianId') guardianId: string,
    @ValidBody(GuardianVerify) body: GuardianVerify,
  ): Promise<DataEnvelope<GuardianSummary>> {
    return ok(await this.guardians.verify(user, id, guardianId, body.basis));
  }

  @Post(':guardianId/invite')
  @RequirePermission('guardian.manage', ATHLETE)
  @HttpCode(202)
  async invite(
    @UuidParam('id') id: string,
    @UuidParam('guardianId') guardianId: string,
    @ValidBody(GuardianInvite) body: GuardianInvite,
  ): Promise<DataEnvelope<{ status: 'INVITE_SENT' }>> {
    await this.guardians.invite(id, guardianId, body.email, RequestContextStore.current().locale);
    return ok({ status: 'INVITE_SENT' });
  }

  @Delete(':guardianId')
  @RequirePermission('guardian.manage', ATHLETE)
  @HttpCode(204)
  async end(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('guardianId') guardianId: string,
    @ValidBody(ReasonRequest) body: ReasonRequest,
  ): Promise<void> {
    await this.guardians.end(user, id, guardianId, body.reason);
  }
}

/** Кабинет представителя и спортсмена: «мои спортсмены», принятие приглашения представителя. */
@Controller()
export class MyAthletesController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('me/athletes')
  @Authenticated()
  async mine(@CurrentUser() user: AuthUser): Promise<DataEnvelope<MyAthlete[]>> {
    return ok(await this.guardians.myAthletes(user));
  }

  @Post('guardian-invites/accept')
  @Authenticated()
  @HttpCode(200)
  async accept(
    @CurrentUser() user: AuthUser,
    @ValidBody(TokenRequest) body: TokenRequest,
  ): Promise<DataEnvelope<MyAthlete[]>> {
    return ok(await this.guardians.acceptInvite(user, body.token));
  }
}
