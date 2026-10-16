// Профиль спортсмена по одобренной заявке (Phase 9a): спортсмен регистрирует себя сам (его учётная запись — запись
// «человек» профиля), присоединяется к организации и тренеру. Переход в другой клуб или к другому тренеру закрывает
// прежнее основное членство или основного тренера днём раньше — история периодов сохраняется.
import { Injectable } from '@nestjs/common';
import { publicId, type Tx, uuidv7 } from '@sde/db';
import { AuditService } from '../../audit';
import { dateOnly, todayIso } from '../domain/athlete-rules';

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

/** День до `newFrom`, но не раньше начала закрываемого периода (CHECK: конец не раньше начала). */
function closeAt(validFrom: string, newFrom: string): string {
  const d = toDate(newFrom);
  d.setUTCDate(d.getUTCDate() - 1);
  const before = dateOnly(d);
  return before < validFrom ? validFrom : before;
}

@Injectable()
export class AthleteRegistryService {
  constructor(private readonly audit: AuditService) {}

  /** Профиль спортсмена человека: существующий (внесённый тренером ранее) или новый. */
  async ensureProfile(tx: Tx, personId: string, actorId: string): Promise<string> {
    const existing = await tx.athleteProfile.findUnique({ where: { personId }, select: { id: true } });
    if (existing) return existing.id;
    const id = uuidv7();
    await tx.athleteProfile.create({ data: { id, personId, publicId: publicId(), createdById: actorId } });
    await this.audit.record(tx, {
      action: 'athlete.created',
      entityType: 'AthleteProfile',
      entityId: id,
      after: { personId, via: 'onboarding' },
    });
    return id;
  }

  /** Профиль спортсмена человека, если есть. */
  async profileOf(tx: Tx, personId: string): Promise<string | null> {
    const row = await tx.athleteProfile.findUnique({ where: { personId }, select: { id: true } });
    return row?.id ?? null;
  }

  /**
   * Основной клуб и основной тренер с сегодняшнего дня. Если спортсмен уже в этом клубе и у этого тренера — ничего
   * не меняется; прежние основные закрываются (смена клуба или тренера).
   */
  async joinOrganization(
    tx: Tx,
    athleteId: string,
    organizationId: string,
    coachId: string | null,
    actorId: string,
  ): Promise<void> {
    const today = todayIso();
    const open = await tx.athleteMembership.findFirst({
      where: { athleteId, organizationId, validTo: null },
    });
    if (!open || !open.isPrimary) {
      const primary = await tx.athleteMembership.findFirst({
        where: { athleteId, isPrimary: true, validTo: null },
      });
      if (primary) {
        await tx.athleteMembership.update({
          where: { id: primary.id },
          data: { validTo: toDate(closeAt(dateOnly(primary.validFrom), today)) },
        });
        await this.audit.record(tx, {
          action: 'athlete.membership_ended',
          entityType: 'AthleteProfile',
          entityId: athleteId,
          organizationId: primary.organizationId,
          before: { organizationId: primary.organizationId, validTo: null },
          after: { organizationId: primary.organizationId, reason: 'transfer' },
        });
      }
      if (open) {
        // Тот же клуб был дополнительным: закрыть и открыть заново основным.
        await tx.athleteMembership.update({
          where: { id: open.id },
          data: { validTo: toDate(closeAt(dateOnly(open.validFrom), today)) },
        });
      }
      await tx.athleteMembership.create({
        data: {
          id: uuidv7(),
          athleteId,
          organizationId,
          isPrimary: true,
          validFrom: toDate(today),
          createdById: actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'athlete.membership_added',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        organizationId,
        after: { organizationId, isPrimary: true, via: 'onboarding' },
      });
    }
    if (coachId) await this.linkCoach(tx, athleteId, coachId, actorId, organizationId);
  }

  private async linkCoach(
    tx: Tx,
    athleteId: string,
    coachId: string,
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    const today = todayIso();
    const open = await tx.athleteCoach.findFirst({ where: { athleteId, coachId, validTo: null } });
    if (open?.isPrimary) return;
    const primary = await tx.athleteCoach.findFirst({ where: { athleteId, isPrimary: true, validTo: null } });
    for (const link of [primary, open]) {
      if (!link) continue;
      await tx.athleteCoach.update({
        where: { id: link.id },
        data: { validTo: toDate(closeAt(dateOnly(link.validFrom), today)) },
      });
      await this.audit.record(tx, {
        action: 'athlete.coach_unlinked',
        entityType: 'AthleteProfile',
        entityId: athleteId,
        organizationId,
        before: { coachId: link.coachId, validTo: null },
        after: { coachId: link.coachId, reason: 'coach_changed' },
      });
    }
    await tx.athleteCoach.create({
      data: {
        id: uuidv7(),
        athleteId,
        coachId,
        isPrimary: true,
        validFrom: toDate(today),
        createdById: actorId,
      },
    });
    await this.audit.record(tx, {
      action: 'athlete.coach_linked',
      entityType: 'AthleteProfile',
      entityId: athleteId,
      organizationId,
      after: { coachId, isPrimary: true, via: 'onboarding' },
    });
  }
}
