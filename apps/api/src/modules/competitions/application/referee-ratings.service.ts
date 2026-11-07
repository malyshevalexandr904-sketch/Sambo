// Оценки судей (правки 07.11.2026, п. 10): организатор турнира ставит отработавшим судьям от 1 до 5 звёзд — когда
// турнир идёт или завершён. Одна оценка на судью в турнире, повторная заменяет прежнюю. Рейтинг судьи — среднее
// арифметическое всех его оценок (страница судьи, модуль directory).
import { Injectable } from '@nestjs/common';
import {
  CABINET_ROLE_GRANTS,
  type CompetitionRefereeRatingDto,
  REFEREE_RATING_STATUSES,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from './competition-scope.service';

const REFEREE_ROLES = [...CABINET_ROLE_GRANTS.REFEREE];

@Injectable()
export class RefereeRatingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly scopes: CompetitionScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Судьи турнира (действующие и завершившие работу) и поставленные им оценки. */
  async list(competitionId: string): Promise<CompetitionRefereeRatingDto[]> {
    const [members, ratings] = await Promise.all([
      this.db.competitionMembership.findMany({
        where: {
          competitionId,
          userId: { not: null },
          status: { in: ['ACTIVE', 'SUSPENDED', 'ENDED'] },
          role: { code: { in: REFEREE_ROLES } },
        },
        select: { user: { select: { id: true, displayName: true } }, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.refereeRating.findMany({
        where: { competitionId },
        select: { refereeUserId: true, stars: true },
      }),
    ]);
    const stars = new Map(ratings.map((r) => [r.refereeUserId, r.stars]));
    const seen = new Set<string>();
    const out: CompetitionRefereeRatingDto[] = [];
    for (const m of members) {
      if (!m.user || seen.has(m.user.id)) continue;
      // Отстранённого до начала работы (ENDED без оценки) не показываем.
      if (m.status === 'ENDED' && !stars.has(m.user.id)) continue;
      seen.add(m.user.id);
      out.push({ userId: m.user.id, name: m.user.displayName, stars: stars.get(m.user.id) ?? null });
    }
    return out;
  }

  async rate(user: AuthUser, competitionId: string, refereeUserId: string, stars: number): Promise<void> {
    const competition = await this.scopes.require(competitionId);
    if (!(REFEREE_RATING_STATUSES as readonly string[]).includes(competition.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_not_started'] });
    if (refereeUserId === user.id) throw new DomainError('FORBIDDEN', { reason: 'self_assignment' });
    const worked = await this.db.competitionMembership.count({
      where: {
        competitionId,
        userId: refereeUserId,
        status: { in: ['ACTIVE', 'SUSPENDED', 'ENDED'] },
        role: { code: { in: REFEREE_ROLES } },
      },
    });
    if (worked === 0) throw new DomainError('NOT_FOUND', { resource: 'competition_membership' });
    await this.db.tx(async (tx) => {
      const before = await tx.refereeRating.findUnique({
        where: { competitionId_refereeUserId: { competitionId, refereeUserId } },
      });
      const row = await tx.refereeRating.upsert({
        where: { competitionId_refereeUserId: { competitionId, refereeUserId } },
        create: { id: uuidv7(), competitionId, refereeUserId, ratedById: user.id, stars },
        update: { stars, ratedById: user.id },
      });
      await this.audit.record(tx, {
        action: 'referee.rated',
        entityType: 'RefereeRating',
        entityId: row.id,
        competitionId,
        organizationId: competition.organizerOrganizationId,
        before: before ? { stars: before.stars } : null,
        after: { stars, refereeUserId },
      });
    });
  }
}
