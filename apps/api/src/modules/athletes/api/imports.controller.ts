import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { type DataEnvelope, ImportCommitRequest, ImportCreate, type ImportJobDto } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { Idempotent } from '../../../common/http/idempotency';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { ImportsService } from '../application/imports.service';

/** Импорт спортсменов (API.md, 4.4). Право `athlete.import` — в организации из тела; задание видит создатель. */
@Controller('athletes/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @Authenticated()
  @Idempotent()
  @HttpCode(202)
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(ImportCreate) body: ImportCreate,
  ): Promise<DataEnvelope<ImportJobDto>> {
    return ok(await this.imports.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<ImportJobDto>> {
    return ok(await this.imports.get(user, id));
  }

  /** Строки применяются сразу; ответ — задание с итогами по каждой строке. */
  @Post(':id/commit')
  @Authenticated()
  @HttpCode(200)
  async commit(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ImportCommitRequest) body: ImportCommitRequest,
  ): Promise<DataEnvelope<ImportJobDto>> {
    return ok(await this.imports.commit(user, id, body));
  }
}
