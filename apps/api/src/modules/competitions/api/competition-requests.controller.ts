import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  CompetitionRequestCreate,
  type CompetitionRequestDto,
  CompetitionRequestReject,
  CompetitionRequestsQuery,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { CompetitionRequestsService } from '../application/competition-requests.service';

/**
 * Заявки организаций на проведение турнира (docs/RATED_ONLY.md, 2). Права зависят от стороны (организация —
 * `competition.request` в своей организации, платформа — `competition.create_rated`), поэтому проверяются в сервисе.
 */
@Controller('competition-requests')
export class CompetitionRequestsController {
  constructor(private readonly requests: CompetitionRequestsService) {}

  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(CompetitionRequestsQuery) q: CompetitionRequestsQuery,
  ): Promise<Page<CompetitionRequestDto>> {
    return this.requests.list(user, q);
  }

  @Post()
  @Authenticated()
  async submit(
    @CurrentUser() user: AuthUser,
    @ValidBody(CompetitionRequestCreate) body: CompetitionRequestCreate,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.submit(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.get(user, id));
  }

  @Post(':id/withdraw')
  @Authenticated()
  @HttpCode(200)
  async withdraw(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.withdraw(user, id, version));
  }

  @Post(':id/approve')
  @Authenticated()
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.approve(user, id, version));
  }

  @Post(':id/reject')
  @Authenticated()
  @HttpCode(200)
  async reject(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(CompetitionRequestReject) body: CompetitionRequestReject,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.reject(user, id, version, body.reason));
  }
}
