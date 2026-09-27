import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Res } from '@nestjs/common';
import {
  AcceptCompetitionInviteRequest,
  type AuditEntry,
  AuditLogsQuery,
  type Competition,
  CompetitionCreate,
  type CompetitionMember,
  CompetitionMemberInvite,
  CompetitionMemberPatch,
  CompetitionMembersQuery,
  CompetitionPatch,
  CompetitionsQuery,
  type CompetitionSummary,
  CompetitionTransitionRequest,
  type DataEnvelope,
  type Page,
  RegulationUpdate,
} from '@sde/contracts';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/context/current-user';
import { type AuthUser, RequestContextStore } from '../../../common/context/request-context';
import { etag, IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { AuditQueryService } from '../../audit';
import { WriteAuthority } from '../../venue-sync';
import { CompetitionsService } from '../application/competitions.service';
import { RegulationService } from '../application/regulation.service';
import { StaffService } from '../application/staff.service';

const COMP = { resolver: 'competition', param: 'id' };

/**
 * Турниры (API.md, 5.1). Черновик видят персонал и организаторы; опубликованный турнир — любой вошедший.
 * Операционные команды ([L]) проверяют право записи турнира (ADR-21).
 */
@Controller('competitions')
export class CompetitionsController {
  constructor(
    private readonly competitions: CompetitionsService,
    private readonly regulation: RegulationService,
    private readonly staff: StaffService,
    private readonly audit: AuditQueryService,
  ) {}

  private send(res: Response, c: Competition): DataEnvelope<Competition> {
    res.setHeader('ETag', etag(c.version));
    return ok(c);
  }

  @Get()
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(CompetitionsQuery) q: CompetitionsQuery,
  ): Promise<Page<CompetitionSummary>> {
    return this.competitions.list(user, q);
  }

  /** `competition.create` проверяется в организации-организаторе из тела запроса. */
  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(CompetitionCreate) body: CompetitionCreate,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    return this.send(res, await this.competitions.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    return this.send(res, await this.competitions.get(user, id));
  }

  @Patch(':id')
  @RequirePermission('competition.update', COMP)
  @WriteAuthority(COMP)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(CompetitionPatch) body: CompetitionPatch,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    return this.send(res, await this.competitions.update(user, id, version, body));
  }

  @Delete(':id')
  @RequirePermission('competition.delete', COMP)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.competitions.remove(id);
  }

  /** Право зависит от перехода (публикация — `competition.publish`), поэтому проверяется в сервисе. */
  @Post(':id/transitions')
  @Authenticated()
  @WriteAuthority(COMP)
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(CompetitionTransitionRequest) body: CompetitionTransitionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    return this.send(res, await this.competitions.transition(user, id, version, body));
  }

  @Put(':id/regulation')
  @RequirePermission('competition.update', COMP)
  async updateRegulation(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @IfMatchVersion() version: number,
    @ValidBody(RegulationUpdate) body: RegulationUpdate,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataEnvelope<Competition>> {
    await this.regulation.update(user, id, version, body);
    return this.send(res, await this.competitions.get(user, id));
  }

  @Get(':id/members')
  @RequirePermission('competition.view', COMP)
  members(
    @UuidParam('id') id: string,
    @ValidQuery(CompetitionMembersQuery) q: CompetitionMembersQuery,
  ): Promise<Page<CompetitionMember>> {
    return this.staff.list(id, q);
  }

  @Post(':id/members')
  @RequirePermission('competition.members.manage', COMP)
  async invite(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CompetitionMemberInvite) body: CompetitionMemberInvite,
  ): Promise<DataEnvelope<CompetitionMember>> {
    return ok(await this.staff.invite(user, id, body, RequestContextStore.current().locale));
  }

  @Patch(':id/members/:membershipId')
  @RequirePermission('competition.members.manage', COMP)
  async updateMember(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('membershipId') membershipId: string,
    @IfMatchVersion() version: number,
    @ValidBody(CompetitionMemberPatch) body: CompetitionMemberPatch,
  ): Promise<DataEnvelope<CompetitionMember>> {
    return ok(await this.staff.update(user, id, membershipId, version, body));
  }

  /** Журнал аудита турнира (API.md, 3.6). */
  @Get(':id/audit-logs')
  @RequirePermission('audit.view', COMP)
  auditLogs(
    @UuidParam('id') id: string,
    @ValidQuery(AuditLogsQuery) q: AuditLogsQuery,
  ): Promise<Page<AuditEntry>> {
    return this.audit.list(q, id);
  }
}

@Controller('competition-invites')
export class CompetitionInvitesController {
  constructor(private readonly staff: StaffService) {}

  /** Принять приглашение в персонал турнира: только владелец приглашённого подтверждённого email. */
  @Post('accept')
  @Authenticated()
  @HttpCode(200)
  async accept(
    @CurrentUser() user: AuthUser,
    @ValidBody(AcceptCompetitionInviteRequest) body: AcceptCompetitionInviteRequest,
  ): Promise<DataEnvelope<CompetitionMember>> {
    return ok(await this.staff.accept(user, body.token));
  }
}
