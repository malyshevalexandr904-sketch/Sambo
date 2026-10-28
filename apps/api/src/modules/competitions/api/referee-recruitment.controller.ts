import { Controller, Get, Post } from '@nestjs/common';
import type { DataEnvelope, OpenRefereeRecruitmentDto } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { RefereeRecruitmentService } from '../application/referee-recruitment.service';

/**
 * Открытые наборы судей для судьи (правки 27.10.2026): раздел «Судейство». Роль кабинета «Судья» проверяет сервис.
 */
@Controller('referee-recruitment')
export class RefereeRecruitmentController {
  constructor(private readonly recruitment: RefereeRecruitmentService) {}

  @Get()
  @Authenticated()
  async list(@CurrentUser() user: AuthUser): Promise<DataEnvelope<OpenRefereeRecruitmentDto[]>> {
    return ok(await this.recruitment.listOpen(user));
  }

  @Post(':positionId/applications')
  @Authenticated()
  async apply(
    @CurrentUser() user: AuthUser,
    @UuidParam('positionId') positionId: string,
  ): Promise<DataEnvelope<OpenRefereeRecruitmentDto[]>> {
    return ok(await this.recruitment.apply(user, positionId));
  }
}
