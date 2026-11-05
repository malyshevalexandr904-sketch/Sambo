import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  CompetitionRequestCreate,
  CompetitionRequestDraftInput,
  type CompetitionRequestDto,
  CompetitionRequestReject,
  CompetitionRequestsQuery,
  type DataEnvelope,
  type Page,
  type ResponsibleCandidateDto,
  ResponsibleCandidatesQuery,
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

  /** Поиск ответственного за проведение среди зарегистрированных пользователей (по ФИО или почте). */
  @Get('responsible-candidates')
  @Authenticated()
  async responsibleCandidates(
    @CurrentUser() user: AuthUser,
    @ValidQuery(ResponsibleCandidatesQuery) q: ResponsibleCandidatesQuery,
  ): Promise<DataEnvelope<ResponsibleCandidateDto[]>> {
    return ok(await this.requests.responsibleCandidates(user, q));
  }

  @Post()
  @Authenticated()
  async submit(
    @CurrentUser() user: AuthUser,
    @ValidBody(CompetitionRequestCreate) body: CompetitionRequestCreate,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.submit(user, body));
  }

  /** Черновик заявки (правки 05.11.2026): виден только организации, проверка данных — при подаче. */
  @Post('drafts')
  @Authenticated()
  async createDraft(
    @CurrentUser() user: AuthUser,
    @ValidBody(CompetitionRequestDraftInput) body: CompetitionRequestDraftInput,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.saveDraft(user, body));
  }

  @Put(':id/draft')
  @Authenticated()
  async updateDraft(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionRequestDraftInput) body: CompetitionRequestDraftInput,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.saveDraft(user, body, id));
  }

  @Post(':id/discard')
  @Authenticated()
  @HttpCode(204)
  async discard(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    await this.requests.discardDraft(user, id);
  }

  /** Организатор публикует подготовленный турнир по одобренной заявке (стадия «Опубликован»). */
  @Post(':id/publish')
  @Authenticated()
  @HttpCode(200)
  async publish(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CompetitionRequestDto>> {
    return ok(await this.requests.publish(user, id));
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
