// Членства в клубах, тренеры и разряды спортсмена с периодами и историей (API.md, 4.1; DATABASE.md, 3.3).
import { Injectable } from '@nestjs/common';
import type { CoachLinkCreate, MembershipCreate, RankInput, RankRecordDto } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import { OrganizationScopeService } from '../../organizations';
import { dateOnly, endDateValid, primaryHandover } from '../domain/athlete-rules';
import { AthleteAccessService, currentPeriod } from './athlete-access.service';
import { AthleteExtensions } from './athlete-extensions';
import { rankDto } from './athlete-mapper';
import { AthletesService } from './athletes.service';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

@Injectable()
export class AthleteLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly access: AthleteAccessService,
    private readonly athletes: AthletesService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly coaches: CoachesService,
    private readonly audit: AuditService,
    private readonly extensions: AthleteExtensions,
  ) {}

  /**
   * Членство в организации. Основное: прежнее основное закрывается днём раньше — это переход в другой клуб,
   * для него нужно право и в прежней организации. Право в новой организации — всегда.
   */
  async addMembership(user: AuthUser, athleteId: string, input: MembershipCreate): Promise<void> {
    await this.athletes.assertTargetOrganization(user, input.organizationId, 'athlete.view');
    await this.policy.assert(user, 'athlete.update', await this.orgScopes.scopeOf(input.organizationId), {
      athleteId,
    });
    await this.db.tx(async (tx) => {
      const open = await tx.athleteMembership.findFirst({
        where: { athleteId, organizationId: input.organizationId, validTo: null },
      });
      if (open) throw new DomainError('ALREADY_EXISTS', { resource: 'athlete_membership' });
      const closed = input.isPrimary
        ? await this.closePrimaryForTransfer(tx, user, athleteId, input.validFrom)
        : null;
      const created = await tx.athleteMembership.create({
        data: {
          id: uuidv7(),
          athleteId,
          organizationId: input.organizationId,
          isPrimary: input.isPrimary,
          validFrom: toDate(input.validFrom),
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'athlete.membership_added',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        organizationId: input.organizationId,
        after: { membershipId: created.id, ...input, closedPrimary: closed },
      });
    });
  }

  /** Переход: прежнее основное членство закрывается днём раньше, для этого нужно право и в прежней организации. */
  private async closePrimaryForTransfer(
    tx: Tx,
    user: AuthUser,
    athleteId: string,
    validFrom: string,
  ): Promise<{ id: string; organizationId: string; validTo: string } | null> {
    const primary = await tx.athleteMembership.findFirst({
      where: { athleteId, isPrimary: true, validTo: null },
    });
    const handover = primaryHandover(primary ? { validFrom: dateOnly(primary.validFrom) } : null, validFrom);
    if (!handover.ok)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'validFrom', code: 'before_current_primary' }],
      });
    if (!primary || !handover.closeCurrentAt) return null;
    await this.policy.assert(user, 'athlete.update', await this.orgScopes.scopeOf(primary.organizationId), {
      athleteId,
    });
    await tx.athleteMembership.update({
      where: { id: primary.id },
      data: { validTo: toDate(handover.closeCurrentAt) },
    });
    return { id: primary.id, organizationId: primary.organizationId, validTo: handover.closeCurrentAt };
  }

  /** Конец членства. Последнее текущее членство не закрывается — для этого есть архив. */
  async endMembership(
    user: AuthUser,
    athleteId: string,
    membershipId: string,
    validTo: string,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      const m = await tx.athleteMembership.findFirst({ where: { id: membershipId, athleteId } });
      if (!m) throw new DomainError('NOT_FOUND', { resource: 'athlete_membership' });
      await this.policy.assert(user, 'athlete.update', await this.orgScopes.scopeOf(m.organizationId), {
        athleteId,
      });
      if (m.validTo) throw new DomainError('INVALID_TRANSITION', { from: 'ENDED', to: 'ENDED', allowed: [] });
      if (!endDateValid(dateOnly(m.validFrom), validTo))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'validTo', code: 'before_valid_from' }],
        });
      const others = await tx.athleteMembership.count({
        where: { athleteId, id: { not: m.id }, validTo: null },
      });
      if (others === 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['last_membership'] });
      await tx.athleteMembership.update({ where: { id: m.id }, data: { validTo: toDate(validTo) } });
      await this.audit.record(tx, {
        action: 'athlete.membership_ended',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        organizationId: m.organizationId,
        before: { membershipId: m.id, validTo: null },
        after: { membershipId: m.id, validTo },
      });
    });
  }

  /** Тренер спортсмена — тренер одной из его текущих организаций. */
  async addCoach(user: AuthUser, athleteId: string, input: CoachLinkCreate): Promise<void> {
    await this.db.tx(async (tx) => {
      const orgs = await tx.athleteMembership.findMany({
        where: { athleteId, ...currentPeriod() },
        select: { organizationId: true },
      });
      if (
        !(await this.coaches.worksIn(
          tx,
          input.coachId,
          orgs.map((o) => o.organizationId),
        ))
      )
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'coachId', code: 'coach_not_in_club' }],
        });
      const open = await tx.athleteCoach.findFirst({
        where: { athleteId, coachId: input.coachId, validTo: null },
      });
      if (open) throw new DomainError('ALREADY_EXISTS', { resource: 'athlete_coach' });
      let closedPrimary: string | null = null;
      if (input.isPrimary) {
        const primary = await tx.athleteCoach.findFirst({
          where: { athleteId, isPrimary: true, validTo: null },
        });
        const handover = primaryHandover(
          primary ? { validFrom: dateOnly(primary.validFrom) } : null,
          input.validFrom,
        );
        if (!handover.ok)
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: 'validFrom', code: 'before_current_primary' }],
          });
        if (primary && handover.closeCurrentAt) {
          await tx.athleteCoach.update({
            where: { id: primary.id },
            data: { validTo: toDate(handover.closeCurrentAt) },
          });
          closedPrimary = primary.id;
        }
      }
      const link = await tx.athleteCoach.create({
        data: {
          id: uuidv7(),
          athleteId,
          coachId: input.coachId,
          isPrimary: input.isPrimary,
          validFrom: toDate(input.validFrom),
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'athlete.coach_linked',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        after: { linkId: link.id, ...input, closedPrimaryLinkId: closedPrimary },
      });
    });
  }

  async endCoach(athleteId: string, linkId: string, validTo: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const link = await tx.athleteCoach.findFirst({ where: { id: linkId, athleteId } });
      if (!link) throw new DomainError('NOT_FOUND', { resource: 'athlete_coach' });
      if (link.validTo)
        throw new DomainError('INVALID_TRANSITION', { from: 'ENDED', to: 'ENDED', allowed: [] });
      if (!endDateValid(dateOnly(link.validFrom), validTo))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'validTo', code: 'before_valid_from' }],
        });
      await tx.athleteCoach.update({ where: { id: link.id }, data: { validTo: toDate(validTo) } });
      await this.audit.record(tx, {
        action: 'athlete.coach_unlinked',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        before: { linkId, validTo: null },
        after: { linkId, validTo },
      });
    });
  }

  async ranks(user: AuthUser, athleteId: string): Promise<RankRecordDto[]> {
    await this.access.assertView(user, athleteId);
    const rows = await this.db.athleteRankRecord.findMany({
      where: { athleteId },
      orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(rankDto);
  }

  async addRank(user: AuthUser, athleteId: string, input: RankInput): Promise<RankRecordDto> {
    return this.db.tx(async (tx) => {
      if (!(await tx.sportRank.findUnique({ where: { code: input.sportRankCode } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'sportRankCode', code: 'invalid_code' }],
        });
      if (input.documentId && !(await this.extensions.documentBelongs(tx, athleteId, input.documentId)))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'documentId', code: 'invalid_document' }],
        });
      const rank = await tx.athleteRankRecord.create({
        data: {
          id: uuidv7(),
          athleteId,
          sportRankCode: input.sportRankCode,
          assignedAt: toDate(input.assignedAt),
          orderRef: input.orderRef ?? null,
          documentId: input.documentId ?? null,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'athlete.rank_added',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        after: { rankId: rank.id, ...input },
      });
      return rankDto(rank);
    });
  }

  async revokeRank(
    user: AuthUser,
    athleteId: string,
    rankId: string,
    reason: string,
  ): Promise<RankRecordDto> {
    return this.db.tx(async (tx: Tx) => {
      const rank = await tx.athleteRankRecord.findFirst({ where: { id: rankId, athleteId } });
      if (!rank) throw new DomainError('NOT_FOUND', { resource: 'rank' });
      if (rank.revokedAt)
        throw new DomainError('INVALID_TRANSITION', { from: 'REVOKED', to: 'REVOKED', allowed: [] });
      const updated = await tx.athleteRankRecord.update({
        where: { id: rankId },
        data: { revokedAt: new Date(), revokedById: user.id, revokeReason: reason },
      });
      await this.audit.record(tx, {
        action: 'athlete.rank_revoked',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        before: { rankId, revoked: false },
        after: { rankId, revoked: true },
        reason,
      });
      return rankDto(updated);
    });
  }
}
