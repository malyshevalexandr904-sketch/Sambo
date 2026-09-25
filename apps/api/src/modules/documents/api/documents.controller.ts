import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  DocumentCreate,
  type DocumentDto,
  DocumentsQuery,
  DocumentTransitionRequest,
  type DownloadUrl,
  type Page,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { DocumentsService } from '../application/documents.service';

/**
 * Документы (API.md, 4.6). Права зависят от владельца документа и контекста турнира, поэтому проверяются
 * в сервисе: `document.view` / `document.upload` в областях владельца, `document.verify` — в турнире,
 * законный представитель и сам спортсмен — по связи. Каждый просмотр и отказ — в журнале доступа.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(DocumentsQuery) q: DocumentsQuery,
  ): Promise<Page<DocumentDto>> {
    return this.documents.list(user, q);
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(DocumentCreate) body: DocumentCreate,
  ): Promise<DataEnvelope<DocumentDto>> {
    return ok(await this.documents.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<DocumentDto>> {
    return ok(await this.documents.get(user, id));
  }

  @Post(':id/transitions')
  @Authenticated()
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(DocumentTransitionRequest) body: DocumentTransitionRequest,
  ): Promise<DataEnvelope<DocumentDto>> {
    return ok(await this.documents.transition(user, id, version, body));
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<void> {
    await this.documents.remove(user, id);
  }

  @Get(':id/download-url')
  @Authenticated()
  async downloadUrl(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<DownloadUrl>> {
    return ok(await this.documents.downloadUrl(user, id));
  }
}
