import { Controller, HttpCode, Post } from '@nestjs/common';
import { type DataEnvelope, GroupPlaceDecisionInput, type GroupPlaceDecisionDto } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { GroupDecisionService } from '../application/group-decision.service';

const DRAW = { resolver: 'draw', param: 'id' };

/** Решение общего места подгруппы рейтингового формата (ТЗ 31): главный судья (`result.amend`), с причиной. */
@Controller()
export class GroupDecisionsController {
  constructor(private readonly decisions: GroupDecisionService) {}

  @Post('draws/:id/group-decisions')
  @RequirePermission('result.amend', DRAW)
  @WriteAuthority(DRAW)
  @HttpCode(200)
  async decide(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(GroupPlaceDecisionInput) body: GroupPlaceDecisionInput,
  ): Promise<DataEnvelope<GroupPlaceDecisionDto>> {
    return ok(await this.decisions.decide(user, id, body));
  }
}
