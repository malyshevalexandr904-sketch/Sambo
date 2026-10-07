// Раздел «Судейство» (план Phase 7a, §5, §7): ковры турнира текущей сессии, планшет ковра (текущая и следующая
// схватка с доступными действиями), схватки, ждущие подтверждения. Чтение — весь персонал турнира.
import { Controller, Get } from '@nestjs/common';
import type { DataEnvelope, MatConsoleDto, OfficiatingDto, PendingConfirmationDto } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { MatchQueriesService } from '../application/match-queries.service';

const COMP = { resolver: 'competition', param: 'id' };
const MAT = { resolver: 'mat', param: 'id' };

@Controller()
export class OfficiatingController {
  constructor(private readonly queries: MatchQueriesService) {}

  @Get('competitions/:id/officiating')
  @RequirePermission('competition.view', COMP)
  async officiating(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<OfficiatingDto>> {
    return ok(await this.queries.officiating(user, id));
  }

  @Get('competitions/:id/pending-confirmations')
  @RequirePermission('competition.view', COMP)
  async pending(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<PendingConfirmationDto[]>> {
    return ok(await this.queries.pending(user, id));
  }

  @Get('mats/:id/console')
  @RequirePermission('competition.view', MAT)
  async console(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<MatConsoleDto>> {
    return ok(await this.queries.console(user, id));
  }
}
