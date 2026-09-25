import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  type DataEnvelope,
  RuleSetCreate,
  type RuleSetDto,
  RuleSetsQuery,
  RuleSetVersionCreate,
  type RuleSetVersionDto,
  RuleSetVersionPatch,
} from '@sde/contracts';
import { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { RuleSetsService } from '../application/rulesets.service';

const RULESET = { resolver: 'ruleset', param: 'id' };
const VersionNumber = z.coerce.number().int().min(1).max(100_000);

/** Наборы правил (API.md, 4.5): читать может любой вошедший — турнир выбирает правила из них. */
@Controller('rulesets')
export class RuleSetsController {
  constructor(private readonly rulesets: RuleSetsService) {}

  @Get()
  @Authenticated()
  async list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(RuleSetsQuery) q: RuleSetsQuery,
  ): Promise<DataEnvelope<RuleSetDto[]>> {
    return ok(await this.rulesets.list(user, q));
  }

  /** Владелец из тела: платформа или организация — право `ruleset.manage` проверяется в сервисе. */
  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(RuleSetCreate) body: RuleSetCreate,
  ): Promise<DataEnvelope<RuleSetDto>> {
    return ok(await this.rulesets.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<RuleSetDto>> {
    return ok(await this.rulesets.get(user, id));
  }

  @Get(':id/versions/:version')
  @Authenticated()
  async getVersion(
    @UuidParam('id') id: string,
    @ValidParam('version', VersionNumber) version: number,
  ): Promise<DataEnvelope<RuleSetVersionDto>> {
    return ok(await this.rulesets.getVersion(id, version));
  }

  @Post(':id/versions')
  @RequirePermission('ruleset.manage', RULESET)
  async createVersion(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(RuleSetVersionCreate) body: RuleSetVersionCreate,
  ): Promise<DataEnvelope<RuleSetVersionDto>> {
    return ok(await this.rulesets.createVersion(user, id, body));
  }

  @Patch(':id/versions/:version')
  @RequirePermission('ruleset.manage', RULESET)
  async updateVersion(
    @UuidParam('id') id: string,
    @ValidParam('version', VersionNumber) version: number,
    @ValidBody(RuleSetVersionPatch) body: RuleSetVersionPatch,
  ): Promise<DataEnvelope<RuleSetVersionDto>> {
    return ok(await this.rulesets.updateVersion(id, version, body.parameters));
  }

  @Post(':id/versions/:version/publish')
  @RequirePermission('ruleset.manage', RULESET)
  @HttpCode(200)
  async publish(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidParam('version', VersionNumber) version: number,
  ): Promise<DataEnvelope<RuleSetVersionDto>> {
    return ok(await this.rulesets.publish(user, id, version));
  }
}
