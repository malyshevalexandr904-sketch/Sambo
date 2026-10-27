import { Controller, Get, Patch, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  type Me,
  type PersonDto,
  SelectCabinetRoleRequest,
  SetAvatarRequest,
  UpdateMeRequest,
  UpsertMyPersonRequest,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { DemoAllowed } from '../../../common/security/demo';
import { ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { MeService } from '../application/me.service';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @Authenticated()
  async get(@CurrentUser() user: AuthUser): Promise<DataEnvelope<Me>> {
    return ok(await this.me.get({ userId: user.id, sessionId: user.sessionId, activeRole: user.activeRole }));
  }

  /** Роль кабинета этой сессии (0.13.0): права и меню — только для неё. */
  @Put('role')
  @Authenticated()
  @DemoAllowed()
  async selectRole(
    @CurrentUser() user: AuthUser,
    @ValidBody(SelectCabinetRoleRequest) body: SelectCabinetRoleRequest,
  ): Promise<DataEnvelope<Me>> {
    return ok(
      await this.me.selectRole(
        { userId: user.id, sessionId: user.sessionId, activeRole: user.activeRole },
        body.role,
      ),
    );
  }

  @Patch()
  @Authenticated()
  async update(
    @CurrentUser() user: AuthUser,
    @ValidBody(UpdateMeRequest) body: UpdateMeRequest,
  ): Promise<DataEnvelope<Me>> {
    return ok(
      await this.me.update({ userId: user.id, sessionId: user.sessionId, activeRole: user.activeRole }, body),
    );
  }

  /** Фото профиля (своё). */
  @Put('avatar')
  @Authenticated()
  async setAvatar(
    @CurrentUser() user: AuthUser,
    @ValidBody(SetAvatarRequest) body: SetAvatarRequest,
  ): Promise<DataEnvelope<Me>> {
    return ok(
      await this.me.setAvatar(
        { userId: user.id, sessionId: user.sessionId, activeRole: user.activeRole },
        body,
      ),
    );
  }

  @Get('person')
  @Authenticated()
  async person(@CurrentUser() user: AuthUser): Promise<DataEnvelope<PersonDto | null>> {
    return ok(await this.me.getPerson(user.id));
  }

  @Put('person')
  @Authenticated()
  async upsertPerson(
    @CurrentUser() user: AuthUser,
    @ValidBody(UpsertMyPersonRequest) body: UpsertMyPersonRequest,
  ): Promise<DataEnvelope<PersonDto>> {
    return ok(await this.me.upsertPerson(user.id, body));
  }
}
