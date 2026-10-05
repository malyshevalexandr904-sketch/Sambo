// Сессии турнирного дня (Phase 6, §1; DATABASE.md, 3.7): «Утро», «Финалы» — начало и конец во времени турнира.
// Право — schedule.manage (TOURNAMENT_MANAGER, SECRETARY). Сессии одного дня (по местной дате турнира) не
// пересекаются, и обе даты — в пределах дат турнира; ограничение — на уровне сервиса (EXCLUDE потребовал бы
// btree_gist ради одной таблицы — см. миграцию).
import { Injectable } from '@nestjs/common';
import { localDateIn, type ScheduleSessionDto, type ScheduleSessionInput, type ScheduleSessionPatch } from '@sde/contracts';
import { type Session, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { WriteLeaseService } from '../../venue-sync';

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly audit: AuditService,
    private readonly leases: WriteLeaseService,
  ) {}

  private toDto(s: Session): ScheduleSessionDto {
    return {
      id: s.id,
      competitionId: s.competitionId,
      name: s.name,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      version: s.version,
      allowedActions: ['schedule.manage'],
    };
  }

  async list(competitionId: string): Promise<ScheduleSessionDto[]> {
    const rows = await this.db.session.findMany({ where: { competitionId }, orderBy: { startsAt: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  /** Обе даты — в пределах дат турнира, не пересекается с другой сессией того же местного дня. */
  private async assertFits(
    competitionId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const competition = await this.competitions.require(competitionId);
    const startDate = localDateIn(startsAt, competition.timezone);
    const endDate = localDateIn(endsAt, competition.timezone);
    if (startDate < competition.startDate || endDate > competition.endDate)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'startsAt', code: 'outside_competition_dates' }],
      });
    const others = await this.db.session.findMany({
      where: { competitionId, id: excludeId ? { not: excludeId } : undefined },
      select: { id: true, startsAt: true, endsAt: true },
    });
    for (const o of others) {
      if (localDateIn(o.startsAt, competition.timezone) !== startDate) continue;
      if (startsAt < o.endsAt && endsAt > o.startsAt) throw new DomainError('SESSION_OVERLAP', { sessionId: o.id });
    }
  }

  async create(user: AuthUser, competitionId: string, input: ScheduleSessionInput): Promise<ScheduleSessionDto> {
    await this.policy.assert(user, 'schedule.manage', await this.competitions.scopeOf(competitionId));
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    await this.assertFits(competitionId, startsAt, endsAt);
    const session = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const created = await tx.session.create({
        data: { id: uuidv7(), competitionId, name: input.name, startsAt, endsAt },
      });
      await this.audit.record(tx, {
        action: 'session.created',
        entityType: 'Session',
        entityId: created.id,
        competitionId,
        after: { name: created.name, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return created;
    });
    return this.toDto(session);
  }

  async update(
    user: AuthUser,
    competitionId: string,
    sessionId: string,
    version: number,
    patch: ScheduleSessionPatch,
  ): Promise<ScheduleSessionDto> {
    await this.policy.assert(user, 'schedule.manage', await this.competitions.scopeOf(competitionId));
    const current = await this.db.session.findFirst({ where: { id: sessionId, competitionId } });
    if (!current) throw new DomainError('NOT_FOUND', { resource: 'session' });
    if (current.version !== version) throw versionConflict(current.version);
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : current.startsAt;
    const endsAt = patch.endsAt ? new Date(patch.endsAt) : current.endsAt;
    if (endsAt <= startsAt)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'endsAt', code: 'range_invalid' }] });
    if (patch.startsAt || patch.endsAt) await this.assertFits(competitionId, startsAt, endsAt, sessionId);
    const session = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const { count } = await tx.session.updateMany({
        where: { id: sessionId, version },
        data: { name: patch.name, startsAt, endsAt, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version + 1);
      await this.audit.record(tx, {
        action: 'session.updated',
        entityType: 'Session',
        entityId: sessionId,
        competitionId,
        before: { name: current.name, startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() },
        after: { name: patch.name ?? current.name, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      });
      return tx.session.findUniqueOrThrow({ where: { id: sessionId } });
    });
    return this.toDto(session);
  }
}
