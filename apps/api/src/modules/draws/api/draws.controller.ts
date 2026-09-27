import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  type CategoryBracketDto,
  type CategoryDrawsDto,
  type DataEnvelope,
  DrawCreate,
  type DrawDto,
  type DrawOverviewRow,
  DrawSupersede,
  type DrawVerifyDto,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { DrawQueriesService } from '../application/draw-queries';
import { DrawsService } from '../application/draws.service';

const COMP = { resolver: 'competition', param: 'id' };
const CATEGORY = { resolver: 'competitionCategory', param: 'id' };
const DRAW = { resolver: 'draw', param: 'id' };

/**
 * Жеребьёвка и сетки (API.md, 6.1): чтение — персонал турнира (`competition.view`), черновик — `draw.create`,
 * публикация — `draw.publish`, новая версия — `draw.republish`. Команды — операционные ([L]).
 */
@Controller()
export class DrawsController {
  constructor(
    private readonly draws: DrawsService,
    private readonly queries: DrawQueriesService,
  ) {}

  @Get('competitions/:id/draws')
  @RequirePermission('competition.view', COMP)
  async overview(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<DrawOverviewRow[]>> {
    return ok(await this.queries.overview(user, id));
  }

  @Get('categories/:id/draws')
  @RequirePermission('competition.view', CATEGORY)
  async list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CategoryDrawsDto>> {
    return ok(await this.queries.categoryDraws(user, id));
  }

  @Post('categories/:id/draws')
  @RequirePermission('draw.create', CATEGORY)
  @WriteAuthority(CATEGORY)
  async create(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(DrawCreate) body: DrawCreate,
  ): Promise<DataEnvelope<DrawDto>> {
    return ok(await this.draws.create(user, id, body));
  }

  @Get('categories/:id/brackets')
  @RequirePermission('competition.view', CATEGORY)
  async bracket(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CategoryBracketDto>> {
    return ok(await this.queries.bracket(user, id));
  }

  @Get('draws/:id')
  @RequirePermission('competition.view', DRAW)
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<DrawDto>> {
    return ok(await this.queries.get(user, id));
  }

  @Post('draws/:id/publish')
  @RequirePermission('draw.publish', DRAW)
  @WriteAuthority(DRAW)
  @HttpCode(200)
  async publish(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<DrawDto>> {
    return ok(await this.draws.publish(user, id, version));
  }

  @Post('draws/:id/supersede')
  @RequirePermission('draw.republish', DRAW)
  @WriteAuthority(DRAW)
  @HttpCode(200)
  async supersede(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(DrawSupersede) body: DrawSupersede,
  ): Promise<DataEnvelope<DrawDto>> {
    return ok(await this.draws.supersede(user, id, version, body.reason));
  }

  @Post('draws/:id/verify')
  @RequirePermission('competition.view', DRAW)
  @HttpCode(200)
  async verify(@UuidParam('id') id: string): Promise<DataEnvelope<DrawVerifyDto>> {
    return ok(await this.queries.verify(id));
  }
}
