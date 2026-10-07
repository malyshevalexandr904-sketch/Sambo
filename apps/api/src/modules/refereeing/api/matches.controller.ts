// Схватки и судейство (API.md, 6.3; план Phase 7a, §7). Чтение — весь персонал турнира (competition.view).
// Переходы — право по переходу проверяет сервис (вызов и пауза — match.update, старт — match.start); события —
// scoring.create / scoring.update; результат и неявка — match.finish; подтверждение — result.confirm. Судье —
// только на ковре схватки в её сессии (политики MAT_ASSIGNED, MAT_CHIEF). Все команды — операционные [L].
import { Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import {
  type DataEnvelope,
  IDEMPOTENCY_HEADER,
  type MatchDetailDto,
  MatchEventCreate,
  type MatchEventResultDto,
  MatchEventsQuery,
  type MatchEventsDto,
  MatchEventVoid,
  MatchNoShowRequest,
  MatchResultInput,
  MatchTransitionRequest,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { Idempotent } from '../../../common/http/idempotency';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { MatchCommandsService } from '../application/match-commands.service';
import { MatchQueriesService } from '../application/match-queries.service';
import { ResultsService } from '../application/results.service';
import { ScoringService } from '../application/scoring.service';

const MATCH = { resolver: 'match', param: 'id' };

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly queries: MatchQueriesService,
    private readonly commands: MatchCommandsService,
    private readonly scoring: ScoringService,
    private readonly results: ResultsService,
  ) {}

  private send(res: Response, m: MatchDetailDto): DataEnvelope<MatchDetailDto> {
    res.setHeader('ETag', etag(m.version));
    return ok(m);
  }

  @Get(':id')
  @RequirePermission('competition.view', MATCH)
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    return this.send(res, await this.queries.detail(user, id));
  }

  @Get(':id/events')
  @RequirePermission('competition.view', MATCH)
  async events(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(MatchEventsQuery) q: MatchEventsQuery,
  ): Promise<DataEnvelope<MatchEventsDto>> {
    return ok(await this.queries.events(user, id, q.afterSeq));
  }

  @Post(':id/transitions')
  @RequirePermission('competition.view', MATCH)
  @WriteAuthority(MATCH)
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(MatchTransitionRequest) body: MatchTransitionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    return this.send(res, await this.commands.transition(user, id, version, body));
  }

  @Post(':id/events')
  @RequirePermission('scoring.create', MATCH)
  @WriteAuthority(MATCH)
  @Idempotent()
  async recordEvent(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string,
    @ValidBody(MatchEventCreate) body: MatchEventCreate,
  ): Promise<DataEnvelope<MatchEventResultDto>> {
    return ok(await this.scoring.record(user, id, key.toLowerCase(), body));
  }

  @Post(':id/events/:eventId/void')
  @RequirePermission('scoring.update', MATCH)
  @WriteAuthority(MATCH)
  @Idempotent()
  async voidEvent(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('eventId') eventId: string,
    @Headers(IDEMPOTENCY_HEADER) key: string,
    @ValidBody(MatchEventVoid) body: MatchEventVoid,
  ): Promise<DataEnvelope<MatchEventResultDto>> {
    return ok(await this.scoring.voidEvent(user, id, eventId, key.toLowerCase(), body));
  }

  @Post(':id/result')
  @RequirePermission('match.finish', MATCH)
  @WriteAuthority(MATCH)
  @HttpCode(200)
  async result(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(MatchResultInput) body: MatchResultInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    return this.send(res, await this.results.record(user, id, version, body));
  }

  @Post(':id/result/confirm')
  @RequirePermission('result.confirm', MATCH)
  @WriteAuthority(MATCH)
  @HttpCode(200)
  async confirm(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    return this.send(res, await this.results.confirm(user, id, version));
  }

  @Post(':id/no-show')
  @RequirePermission('match.finish', MATCH)
  @WriteAuthority(MATCH)
  @HttpCode(200)
  async noShow(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(MatchNoShowRequest) body: MatchNoShowRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<MatchDetailDto>> {
    return this.send(res, await this.commands.noShow(user, id, version, body));
  }
}
