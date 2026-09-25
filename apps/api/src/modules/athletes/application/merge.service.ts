// Слияние дублей спортсменов (G-08; API.md, 4.1): всё переносится на целевой профиль, исходный человек
// помечается `mergedIntoId`, исходный профиль архивируется. Действие платформы, с причиной и аудитом.
import { Injectable } from '@nestjs/common';
import type { Athlete, AthleteMergeRequest } from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { PeopleService } from '../../people';
import { dateOnly, todayIso } from '../domain/athlete-rules';
import { AthleteExtensions, type MergeSide } from './athlete-extensions';
import { AthletesService } from './athletes.service';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

@Injectable()
export class AthleteMergeService {
  constructor(
    private readonly db: PrismaService,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly extensions: AthleteExtensions,
    private readonly athletes: AthletesService,
  ) {}

  async merge(user: AuthUser, req: AthleteMergeRequest): Promise<Athlete> {
    await this.db.tx(async (tx) => {
      const [source, target] = await Promise.all([
        tx.athleteProfile.findUnique({ where: { id: req.sourceAthleteId } }),
        tx.athleteProfile.findUnique({ where: { id: req.targetAthleteId } }),
      ]);
      if (!source || !target) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
      if (
        source.status === 'ARCHIVED' &&
        (await tx.person.findUnique({ where: { id: source.personId } }))?.mergedIntoId
      )
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['already_merged'] });
      const s: MergeSide = { athleteId: source.id, personId: source.personId };
      const t: MergeSide = { athleteId: target.id, personId: target.personId };
      await this.moveMemberships(tx, s, t);
      await this.moveCoaches(tx, s, t);
      await tx.athleteRankRecord.updateMany({
        where: { athleteId: s.athleteId },
        data: { athleteId: t.athleteId },
      });
      await this.moveGuardians(tx, s, t);
      await this.extensions.merge(tx, s, t);
      await this.people.merge(tx, s.personId, t.personId);
      await tx.athleteProfile.update({
        where: { id: s.athleteId },
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      });
      await tx.athleteProfile.update({ where: { id: t.athleteId }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'athlete.merged',
        entityType: 'AthleteProfile',
        entityId: t.athleteId,
        before: { sourceAthleteId: s.athleteId, sourcePersonId: s.personId },
        after: { targetAthleteId: t.athleteId, targetPersonId: t.personId },
        reason: req.reason,
        platformIntervention: true,
      });
      await this.outbox.enqueue(tx, {
        type: 'athlete.merged',
        aggregate: { type: 'AthleteProfile', id: t.athleteId },
        payload: { sourceAthleteId: s.athleteId, targetAthleteId: t.athleteId },
      });
    });
    return this.athletes.get(user, req.targetAthleteId);
  }

  /** Открытое членство в той же организации у цели уже есть — исходное закрывается; основное у цели сохраняется. */
  private async moveMemberships(tx: Tx, s: MergeSide, t: MergeSide): Promise<void> {
    const today = todayIso();
    const targetOpen = await tx.athleteMembership.findMany({
      where: { athleteId: t.athleteId, validTo: null },
    });
    const targetHasPrimary = targetOpen.some((m) => m.isPrimary);
    for (const m of await tx.athleteMembership.findMany({ where: { athleteId: s.athleteId } })) {
      const clash = !m.validTo && targetOpen.some((x) => x.organizationId === m.organizationId);
      const from = dateOnly(m.validFrom);
      await tx.athleteMembership.update({
        where: { id: m.id },
        data: {
          athleteId: t.athleteId,
          isPrimary: m.isPrimary && !m.validTo && targetHasPrimary ? false : m.isPrimary,
          validTo: clash ? toDate(from > today ? from : today) : undefined,
        },
      });
    }
  }

  private async moveCoaches(tx: Tx, s: MergeSide, t: MergeSide): Promise<void> {
    const today = todayIso();
    const targetOpen = await tx.athleteCoach.findMany({ where: { athleteId: t.athleteId, validTo: null } });
    const targetHasPrimary = targetOpen.some((c) => c.isPrimary);
    for (const c of await tx.athleteCoach.findMany({ where: { athleteId: s.athleteId } })) {
      const clash = !c.validTo && targetOpen.some((x) => x.coachId === c.coachId);
      const from = dateOnly(c.validFrom);
      await tx.athleteCoach.update({
        where: { id: c.id },
        data: {
          athleteId: t.athleteId,
          isPrimary: c.isPrimary && !c.validTo && targetHasPrimary ? false : c.isPrimary,
          validTo: clash ? toDate(from > today ? from : today) : undefined,
        },
      });
    }
  }

  private async moveGuardians(tx: Tx, s: MergeSide, t: MergeSide): Promise<void> {
    const targetActive = await tx.guardian.findMany({ where: { athleteId: t.athleteId, endedAt: null } });
    for (const g of await tx.guardian.findMany({ where: { athleteId: s.athleteId } })) {
      const clash = !g.endedAt && targetActive.some((x) => x.guardianPersonId === g.guardianPersonId);
      await tx.guardian.update({
        where: { id: g.id },
        data: clash
          ? { endedAt: new Date(), endReason: 'merged: duplicate athlete record' }
          : { athleteId: t.athleteId },
      });
    }
  }
}
