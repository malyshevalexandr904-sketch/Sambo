import { Controller, HttpCode, Post } from '@nestjs/common';
import { type Athlete, AthleteMergeRequest, type DataEnvelope } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { ValidBody } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { AthleteMergeService } from '../application/merge.service';

@Controller('admin/athletes')
export class AdminAthletesController {
  constructor(private readonly merges: AthleteMergeService) {}

  /** Слияние дублей (G-08): право платформы, обязательная причина. */
  @Post('merge')
  @RequirePermission('athlete.merge', PLATFORM_SCOPE)
  @HttpCode(200)
  async merge(
    @CurrentUser() user: AuthUser,
    @ValidBody(AthleteMergeRequest) body: AthleteMergeRequest,
  ): Promise<DataEnvelope<Athlete>> {
    return ok(await this.merges.merge(user, body));
  }
}
