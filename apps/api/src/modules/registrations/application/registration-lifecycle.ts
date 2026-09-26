// Заявки в жизненном цикле турнира и категорий: счётчики, предупреждение перед мандатной комиссией,
// перенос участий при объединении категорий и при слиянии дублей спортсменов.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AthleteExtensions } from '../../athletes';
import { CategoryExtensions, type EntryStats } from '../../categories';
import { CompetitionExtensions } from '../../competitions';
import { ACTIVE_ENTRY_STATUSES } from '../domain/entry-rules';

const ACTIVE = [...ACTIVE_ENTRY_STATUSES];

@Injectable()
export class RegistrationLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly competitions: CompetitionExtensions,
    private readonly categories: CategoryExtensions,
    private readonly athletes: AthleteExtensions,
  ) {}

  onModuleInit(): void {
    this.competitions.registerCounters(async (tx, competitionId) => {
      const client = tx ?? this.db;
      const [applications, approved, pending] = await Promise.all([
        client.application.count({ where: { competitionId, status: { notIn: ['DRAFT', 'CANCELLED'] } } }),
        client.entry.count({ where: { competitionId, status: 'APPROVED' } }),
        client.entry.count({ where: { competitionId, status: 'PENDING' } }),
      ]);
      return { applications, entriesApproved: approved, entriesPending: pending };
    });

    // Мандатная комиссия (REGISTRATION_CLOSED → CHECK_IN): нерассмотренные заявки — предупреждение с подтверждением.
    this.competitions.registerCheck(async ({ tx, competition, from, to }) => {
      if (from !== 'REGISTRATION_CLOSED' || to !== 'CHECK_IN') return { blocking: [] };
      const open = await tx.application.count({
        where: { competitionId: competition.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      });
      return { blocking: [], warnings: open > 0 ? ['applications_pending_review'] : [] };
    });

    this.categories.registerEntryStats((tx, ids) => this.stats(tx, ids));
    this.categories.registerMergeHandler({
      conflicts: async (tx, categoryIds) => {
        const rows = await tx.entry.groupBy({
          by: ['athleteId'],
          where: { categoryId: { in: categoryIds }, status: { in: ACTIVE } },
          _count: { _all: true },
        });
        return rows.filter((r) => r._count._all > 1).map((r) => r.athleteId);
      },
      move: async (tx, sourceIds, targetId) => {
        const { count } = await tx.entry.updateMany({
          where: { categoryId: { in: sourceIds }, status: { in: ACTIVE } },
          data: { categoryId: targetId, version: { increment: 1 } },
        });
        return count;
      },
    });

    // Слияние дублей спортсменов: участия переходят к оставшемуся профилю, если он не заявлен в ту же категорию.
    this.athletes.registerMergeParticipant(async (tx, source, target) => {
      const clash = await tx.entry.findFirst({
        where: {
          athleteId: source.athleteId,
          status: { in: ACTIVE },
          category: { entries: { some: { athleteId: target.athleteId, status: { in: ACTIVE } } } },
        },
        select: { id: true },
      });
      if (clash)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['athletes_in_same_category'] });
      await tx.entry.updateMany({
        where: { athleteId: source.athleteId },
        data: { athleteId: target.athleteId },
      });
    });
  }

  private async stats(tx: Tx | null, categoryIds: string[]): Promise<Map<string, EntryStats>> {
    const rows = await (tx ?? this.db).entry.groupBy({
      by: ['categoryId', 'status'],
      where: { categoryId: { in: categoryIds } },
      _count: { _all: true },
    });
    const result = new Map<string, EntryStats>();
    for (const r of rows) {
      const s = { ...(result.get(r.categoryId) ?? { active: 0, approved: 0, total: 0 }) };
      s.total += r._count._all;
      if (ACTIVE.includes(r.status)) s.active += r._count._all;
      if (r.status === 'APPROVED') s.approved += r._count._all;
      result.set(r.categoryId, s);
    }
    return result;
  }
}
