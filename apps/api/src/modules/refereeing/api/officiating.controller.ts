// Раздел «Судейство» (план Phase 7a, §5, §7): ковры турнира текущей сессии, планшет ковра (текущая и следующая
// схватка с доступными действиями), схватки, ждущие подтверждения. Чтение — весь персонал турнира.
import { Controller, Get, Post, Res } from '@nestjs/common';
import {
  type CategoryProtocolDto,
  type DataEnvelope,
  ManualMatchCreate,
  type MatchDetailDto,
  type MatConsoleDto,
  type OfficiatingDto,
  type PendingConfirmationDto,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { etag, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { ManualMatchesService } from '../application/manual-matches.service';
import { MatchQueriesService } from '../application/match-queries.service';
import { ProtocolsService } from '../application/protocols.service';

const COMP = { resolver: 'competition', param: 'id' };
const MAT = { resolver: 'mat', param: 'id' };
const CATEGORY = { resolver: 'competitionCategory', param: 'id' };

@Controller()
export class OfficiatingController {
  constructor(
    private readonly queries: MatchQueriesService,
    private readonly manual: ManualMatchesService,
    private readonly protocols: ProtocolsService,
  ) {}

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

  /** Ручная схватка вне сетки (Phase 7b): в конец ковра сессии; на места не влияет. */
  @Post('categories/:id/matches')
  @RequirePermission('match.create', CATEGORY)
  @WriteAuthority(CATEGORY)
  async createMatch(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ManualMatchCreate) body: ManualMatchCreate,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    const m = await this.manual.create(user, id, body);
    res.setHeader('ETag', etag(m.version));
    return ok(m);
  }

  @Get('categories/:id/protocol')
  @RequirePermission('export.create', CATEGORY)
  async categoryProtocol(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CategoryProtocolDto>> {
    return ok(await this.protocols.category(user, id));
  }
}
