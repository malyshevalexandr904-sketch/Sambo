import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { type DataEnvelope, type DownloadUrl, type StoredFileDto, UploadRequest, type UploadTicket } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { FilesService } from '../application/files.service';

/** Право на цель загрузки и на скачивание проверяют политики FilesService (регистрируются модулями-владельцами). */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('uploads')
  @Authenticated()
  @RateLimit('upload')
  async createUpload(@CurrentUser() user: AuthUser, @ValidBody(UploadRequest) body: UploadRequest): Promise<DataEnvelope<UploadTicket>> {
    return ok(await this.files.createUpload(user, body));
  }

  @Post(':id/complete')
  @Authenticated()
  @RateLimit('upload')
  @HttpCode(200)
  async complete(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<StoredFileDto>> {
    return ok(await this.files.complete(user, id));
  }

  @Get(':id/download-url')
  @Authenticated()
  async downloadUrl(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<DownloadUrl>> {
    return ok(await this.files.downloadUrl(user, id));
  }
}
