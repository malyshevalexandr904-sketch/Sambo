import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  DivisionCreate,
  type DivisionDto,
  type DivisionList,
  DivisionPatch,
  DivisionPolicyUpdate,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody } from '../../../common/validation/zod.pipe';
import { Authenticated, PLATFORM_SCOPE, RequirePermission } from '../../access';
import { DivisionsService } from '../application/divisions.service';

/** Дивизионы и правило счёта возраста — любому вошедшему: их показывают кабинеты спортсмена и тренера. */
@Controller('divisions')
export class DivisionsController {
  constructor(private readonly divisions: DivisionsService) {}

  @Get()
  @Authenticated()
  async list(): Promise<DataEnvelope<DivisionList>> {
    return ok(await this.divisions.list());
  }
}

/** Управление дивизионами — администратор платформы (`division.manage`). */
@Controller('admin/divisions')
export class AdminDivisionsController {
  constructor(private readonly divisions: DivisionsService) {}

  @Post()
  @RequirePermission('division.manage', PLATFORM_SCOPE)
  async create(@ValidBody(DivisionCreate) body: DivisionCreate): Promise<DataEnvelope<DivisionDto>> {
    return ok(await this.divisions.create(body));
  }

  @Put('age-policy')
  @RequirePermission('division.manage', PLATFORM_SCOPE)
  async policy(
    @CurrentUser() user: AuthUser,
    @ValidBody(DivisionPolicyUpdate) body: DivisionPolicyUpdate,
  ): Promise<DataEnvelope<DivisionList>> {
    return ok(await this.divisions.setPolicy(user.id, body.agePolicy));
  }

  @Patch(':id')
  @RequirePermission('division.manage', PLATFORM_SCOPE)
  async update(
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(DivisionPatch) body: DivisionPatch,
  ): Promise<DataEnvelope<DivisionDto>> {
    return ok(await this.divisions.update(id, version, body));
  }

  @Delete(':id')
  @RequirePermission('division.manage', PLATFORM_SCOPE)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.divisions.remove(id);
  }
}
