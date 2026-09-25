import { Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  type Athlete,
  AthleteCreate,
  AthletePatch,
  AthletesQuery,
  type AthleteSummary,
  CoachLinkCreate,
  type DataEnvelope,
  type DuplicateCandidate,
  DuplicatesCheckRequest,
  MembershipCreate,
  type Page,
  PeriodEnd,
  RankInput,
  type RankRecordDto,
  ReasonRequest,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { AthleteLinksService } from '../application/athlete-links.service';
import { AthletesService } from '../application/athletes.service';

const ATHLETE = { resolver: 'athlete', param: 'id' };

/**
 * Спортсмены (API.md, 4.1). Область спортсмена — организации его текущих членств; тренеру изменение доступно
 * по политике COACH_OWN. Просмотр — ещё и SELF / GUARDIAN, поэтому проверяется в сервисе.
 */
@Controller('athletes')
export class AthletesController {
  constructor(
    private readonly athletes: AthletesService,
    private readonly links: AthleteLinksService,
  ) {}

  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(AthletesQuery) q: AthletesQuery,
  ): Promise<Page<AthleteSummary>> {
    return this.athletes.list(user, q);
  }

  @Post('duplicates-check')
  @Authenticated()
  @HttpCode(200)
  async duplicatesCheck(
    @CurrentUser() user: AuthUser,
    @ValidBody(DuplicatesCheckRequest) body: DuplicatesCheckRequest,
  ): Promise<DataEnvelope<DuplicateCandidate[]>> {
    return ok(await this.athletes.duplicatesCheck(user, body.person));
  }

  /** Право `athlete.create` проверяется в организации из тела запроса. */
  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(AthleteCreate) body: AthleteCreate,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Athlete>> {
    const athlete = await this.athletes.create(user, body);
    res.setHeader('ETag', etag(athlete.version));
    return ok(athlete);
  }

  @Get(':id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Athlete>> {
    const athlete = await this.athletes.get(user, id);
    res.setHeader('ETag', etag(athlete.version));
    return ok(athlete);
  }

  @Patch(':id')
  @RequirePermission('athlete.update', ATHLETE)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(AthletePatch) body: AthletePatch,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Athlete>> {
    const athlete = await this.athletes.update(user, id, version, body);
    res.setHeader('ETag', etag(athlete.version));
    return ok(athlete);
  }

  @Post(':id/archive')
  @RequirePermission('athlete.archive', ATHLETE)
  @HttpCode(200)
  async archive(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(ReasonRequest) body: ReasonRequest,
  ): Promise<DataEnvelope<Athlete>> {
    return ok(await this.athletes.archive(user, id, body.reason));
  }

  @Post(':id/memberships')
  @RequirePermission('athlete.update', ATHLETE)
  async addMembership(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(MembershipCreate) body: MembershipCreate,
  ): Promise<DataEnvelope<Athlete>> {
    await this.links.addMembership(user, id, body);
    return ok(await this.athletes.get(user, id));
  }

  @Post(':id/memberships/:membershipId/end')
  @RequirePermission('athlete.update', ATHLETE)
  @HttpCode(200)
  async endMembership(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('membershipId') membershipId: string,
    @ValidBody(PeriodEnd) body: PeriodEnd,
  ): Promise<DataEnvelope<Athlete>> {
    await this.links.endMembership(user, id, membershipId, body.validTo);
    return ok(await this.athletes.get(user, id));
  }

  @Post(':id/coaches')
  @RequirePermission('athlete.update', ATHLETE)
  async addCoach(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CoachLinkCreate) body: CoachLinkCreate,
  ): Promise<DataEnvelope<Athlete>> {
    await this.links.addCoach(user, id, body);
    return ok(await this.athletes.get(user, id));
  }

  @Post(':id/coaches/:linkId/end')
  @RequirePermission('athlete.update', ATHLETE)
  @HttpCode(200)
  async endCoach(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('linkId') linkId: string,
    @ValidBody(PeriodEnd) body: PeriodEnd,
  ): Promise<DataEnvelope<Athlete>> {
    await this.links.endCoach(id, linkId, body.validTo);
    return ok(await this.athletes.get(user, id));
  }

  @Get(':id/ranks')
  @Authenticated()
  async ranks(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<RankRecordDto[]>> {
    return ok(await this.links.ranks(user, id));
  }

  @Post(':id/ranks')
  @RequirePermission('athlete.update', ATHLETE)
  async addRank(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(RankInput) body: RankInput,
  ): Promise<DataEnvelope<RankRecordDto>> {
    return ok(await this.links.addRank(user, id, body));
  }

  @Post(':id/ranks/:rankId/revoke')
  @RequirePermission('athlete.update', ATHLETE)
  @HttpCode(200)
  async revokeRank(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('rankId') rankId: string,
    @ValidBody(ReasonRequest) body: ReasonRequest,
  ): Promise<DataEnvelope<RankRecordDto>> {
    return ok(await this.links.revokeRank(user, id, rankId, body.reason));
  }
}
