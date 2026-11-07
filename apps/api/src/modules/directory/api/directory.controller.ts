import { Controller, Get, Put } from '@nestjs/common';
import {
  type DataEnvelope,
  RefereeExperiencePut,
  type RefereeStatsDto,
  type UserProfileDto,
  UserSearchQuery,
  type UserSearchItem,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated } from '../../access';
import { DirectoryService } from '../application/directory.service';
import { RefereeExperienceService } from '../application/referee-experience.service';

/** Участники платформы (правки 07.11.2026, п. 7, 8): поиск по ФИО и страница участника — только для вошедших. */
@Controller()
export class DirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly experience: RefereeExperienceService,
  ) {}

  @Get('people/search')
  @Authenticated()
  async search(@ValidQuery(UserSearchQuery) q: UserSearchQuery): Promise<DataEnvelope<UserSearchItem[]>> {
    return ok(await this.directory.search(q.q));
  }

  @Get('people/:userId')
  @Authenticated()
  async profile(
    @CurrentUser() user: AuthUser,
    @UuidParam('userId') userId: string,
  ): Promise<DataEnvelope<UserProfileDto>> {
    return ok(await this.directory.profile(user, userId));
  }

  /** Судья указывает год начала судейской практики — стаж на его странице (п. 10). */
  @Put('me/referee-experience')
  @Authenticated()
  async setExperience(
    @CurrentUser() user: AuthUser,
    @ValidBody(RefereeExperiencePut) body: RefereeExperiencePut,
  ): Promise<DataEnvelope<RefereeStatsDto>> {
    await this.experience.set(user, body.sinceYear);
    return ok(await this.directory.refereeStats(user.id));
  }
}
