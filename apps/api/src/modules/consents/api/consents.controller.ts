import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ConsentCreate,
  type ConsentDto,
  ConsentRevoke,
  ConsentTemplateCreate,
  type ConsentTemplateDto,
  ConsentTemplatePatch,
  ConsentTemplatesQuery,
  type DataEnvelope,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, PLATFORM_SCOPE, Public, RequirePermission } from '../../access';
import { ConsentTemplatesService } from '../application/consent-templates.service';
import { ConsentsService } from '../application/consents.service';

/** Действующие тексты согласий — открыты: их читают до входа и перед подписанием. */
@Controller('consent-templates')
export class ConsentTemplatesController {
  constructor(private readonly templates: ConsentTemplatesService) {}

  @Get()
  @Public()
  async list(
    @ValidQuery(ConsentTemplatesQuery) q: ConsentTemplatesQuery,
  ): Promise<DataEnvelope<ConsentTemplateDto[]>> {
    return ok(await this.templates.published(q));
  }
}

/** Редактор текстов согласий (API.md, 4.2): черновик → публикация, после публикации — неизменяемо. */
@Controller('admin/consent-templates')
export class AdminConsentTemplatesController {
  constructor(private readonly templates: ConsentTemplatesService) {}

  @Get()
  @RequirePermission('consent_template.manage', PLATFORM_SCOPE)
  async list(
    @ValidQuery(ConsentTemplatesQuery) q: ConsentTemplatesQuery,
  ): Promise<DataEnvelope<ConsentTemplateDto[]>> {
    return ok(await this.templates.all(q));
  }

  @Post()
  @RequirePermission('consent_template.manage', PLATFORM_SCOPE)
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(ConsentTemplateCreate) body: ConsentTemplateCreate,
  ): Promise<DataEnvelope<ConsentTemplateDto>> {
    return ok(await this.templates.create(body, user.id));
  }

  @Patch(':id')
  @RequirePermission('consent_template.manage', PLATFORM_SCOPE)
  async update(
    @UuidParam('id') id: string,
    @ValidBody(ConsentTemplatePatch) body: ConsentTemplatePatch,
  ): Promise<DataEnvelope<ConsentTemplateDto>> {
    return ok(await this.templates.update(id, body));
  }

  @Post(':id/publish')
  @RequirePermission('consent_template.manage', PLATFORM_SCOPE)
  @HttpCode(200)
  async publish(@UuidParam('id') id: string): Promise<DataEnvelope<ConsentTemplateDto>> {
    return ok(await this.templates.publish(id));
  }
}

/**
 * Согласия спортсмена. Электронное — только представитель (или совершеннолетний спортсмен) из своего аккаунта,
 * бумажное — `consent.record`; поэтому проверка в сервисе.
 */
@Controller()
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('athletes/:id/consents')
  @Authenticated()
  async list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<ConsentDto[]>> {
    return ok(await this.consents.list(user, id));
  }

  @Post('athletes/:id/consents')
  @Authenticated()
  async give(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ConsentCreate) body: ConsentCreate,
  ): Promise<DataEnvelope<ConsentDto>> {
    return ok(await this.consents.give(user, id, body));
  }

  @Post('consents/:id/revoke')
  @Authenticated()
  @HttpCode(200)
  async revoke(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ConsentRevoke) body: ConsentRevoke,
  ): Promise<DataEnvelope<ConsentDto>> {
    return ok(await this.consents.revoke(user, id, body.reason));
  }
}
