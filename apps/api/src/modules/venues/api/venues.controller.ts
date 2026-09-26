import { Controller, Get, Patch, Post } from '@nestjs/common';
import { type DataEnvelope, type VenueDto, VenueInput, VenuePatch, VenuesQuery } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { VenuesService } from '../application/venues.service';

/** Места проведения (API.md, 5.1): `venue.manage` в организации-владельце. */
@Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @Authenticated()
  async list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(VenuesQuery) q: VenuesQuery,
  ): Promise<DataEnvelope<VenueDto[]>> {
    return ok(await this.venues.list(user, q));
  }

  /** Право проверяется в организации-владельце из тела запроса. */
  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(VenueInput) body: VenueInput,
  ): Promise<DataEnvelope<VenueDto>> {
    return ok(await this.venues.create(user, body));
  }

  @Patch(':id')
  @RequirePermission('venue.manage', { resolver: 'venue', param: 'id' })
  async update(
    @UuidParam('id') id: string,
    @ValidBody(VenuePatch) body: VenuePatch,
  ): Promise<DataEnvelope<VenueDto>> {
    return ok(await this.venues.update(id, body));
  }
}
