import { Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  AcceptInviteRequest,
  type DataEnvelope,
  InviteMemberRequest,
  MembersQuery,
  type Membership,
  MembershipPatch,
  type Organization,
  OrganizationInput,
  OrganizationPatch,
  OrganizationsQuery,
  type OrganizationSummary,
  OrganizationTransitionRequest,
  type Page,
} from '@sde/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { MembersService } from '../application/members.service';
import { OrganizationsService } from '../application/organizations.service';

const ORG = { resolver: 'organization', param: 'id' };
const ORG_PARENT = { resolver: 'organizationParent', param: 'id' };

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly members: MembersService,
  ) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser, @ValidQuery(OrganizationsQuery) q: OrganizationsQuery): Promise<Page<OrganizationSummary>> {
    return this.organizations.list(user, q);
  }

  /** Любой вошедший может подать организацию на проверку; с правом на родителя — сразу ACTIVE. */
  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(OrganizationInput) body: OrganizationInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Organization>> {
    const org = await this.organizations.create(user, body);
    res.setHeader('ETag', etag(org.version));
    return ok(org);
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string, @Res({ passthrough: true }) res: Response): Promise<DataEnvelope<Organization>> {
    const org = await this.organizations.get(user, id);
    res.setHeader('ETag', etag(org.version));
    return ok(org);
  }

  @Patch(':id')
  @RequirePermission('organization.update', ORG)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OrganizationPatch) body: OrganizationPatch,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Organization>> {
    const org = await this.organizations.update(user, id, version, body);
    res.setHeader('ETag', etag(org.version));
    return ok(org);
  }

  @Post(':id/transitions')
  @RequirePermission('organization.approve', ORG_PARENT)
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(OrganizationTransitionRequest) body: OrganizationTransitionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Organization>> {
    const org = await this.organizations.transition(user, id, version, body);
    res.setHeader('ETag', etag(org.version));
    return ok(org);
  }

  @Get(':id/members')
  @RequirePermission('organization.members.view', ORG)
  listMembers(@UuidParam('id') id: string, @ValidQuery(MembersQuery) q: MembersQuery): Promise<Page<Membership>> {
    return this.members.list(id, q);
  }

  @Post(':id/members')
  @RequirePermission('organization.members.manage', ORG)
  async invite(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(InviteMemberRequest) body: InviteMemberRequest,
  ): Promise<DataEnvelope<Membership>> {
    return ok(await this.members.invite(user, id, body, RequestContextStore.current().locale));
  }

  @Patch(':id/members/:membershipId')
  @RequirePermission('organization.members.manage', ORG)
  async updateMember(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('membershipId') membershipId: string,
    @IfMatchVersion() version: number,
    @ValidBody(MembershipPatch) body: MembershipPatch,
  ): Promise<DataEnvelope<Membership>> {
    return ok(await this.members.update(user, id, membershipId, version, body));
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly members: MembersService) {}

  @Post('accept')
  @Authenticated()
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @ValidBody(AcceptInviteRequest) body: z.infer<typeof AcceptInviteRequest>): Promise<DataEnvelope<Membership>> {
    return ok(await this.members.accept(user, body.token));
  }
}
