import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { OrganizationsModule } from '../organizations';
import { VenuesController } from './api/venues.controller';
import { VenuesService } from './application/venues.service';

/** Места проведения турниров (Phase 4a). Ковры места — Phase 6. */
@Module({
  imports: [OrganizationsModule, AuditModule],
  controllers: [VenuesController],
  providers: [VenuesService],
})
export class VenuesModule {}
