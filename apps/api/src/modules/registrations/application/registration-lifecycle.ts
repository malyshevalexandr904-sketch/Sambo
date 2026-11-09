// Заявки в жизненном цикле турнира и категорий: счётчики, предупреждение перед мандатной комиссией,
// перенос участий при объединении категорий и при слиянии дублей спортсменов.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AthleteExtensions } from '../../athletes';
import { CategoryExtensions, type EntryStats } from '../../categories';
import { AuditService } from '../../audit';
import { CompetitionExtensions, type TransitionContext } from '../../competitions';
import { OutboxService } from '../../outbox';
import { ACTIVE_ENTRY_STATUSES } from '../domain/entry-rules';
import { RosterService } from './roster.service';

const ACTIVE = [...ACTIVE_ENTRY_STATUSES];
const AUTO_REJECT_REASON = 'Заявка не исправлена до окончания мандатной комиссии';

@Injectable()
export class RegistrationLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly competitions: CompetitionExtensions,
    private readonly categories: CategoryExtensions,
    private readonly athletes: AthleteExtensions,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly roster: RosterService,
  ) {}

  onModuleInit(): void {
    this.competitions.registerCounters(async (tx, competitionId) => {
      const client = tx ?? this.db;
      const [applications, approved, pending] = await Promise.all([
        client.application.count({ where: { competitionId, status: { notIn: ['DRAFT', 'CANCELLED'] } } }),
        client.entry.count({ where: { competitionId, status: 'APPROVED' } }),
        client.entry.count({
          where: { competitionId, status: 'PENDING', application: { status: { not: 'DRAFT' } } },
        }),
      ]);
      return { applications, entriesApproved: approved, entriesPending: pending };
    });

    // Мандатная комиссия (REGISTRATION_CLOSED → CHECK_IN): нерассмотренные заявки и заявки, не исправленные после
    // возврата, — предупреждения с подтверждением.
    this.competitions.registerCheck(async ({ tx, competition, from, to }) => {
      if (from !== 'REGISTRATION_CLOSED' || to !== 'CHECK_IN') return { blocking: [] };
      const [open, waiting] = await Promise.all([
        tx.application.count({
          where: { competitionId: competition.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        }),
        tx.application.count({ where: { competitionId: competition.id, status: 'WAITING_DOCUMENTS' } }),
      ]);
      const warnings: string[] = [];
      if (open > 0) warnings.push('applications_pending_review');
      if (waiting > 0) warnings.push('applications_will_be_rejected');
      return { blocking: [], warnings };
    });

    // Окончание мандатной комиссии (правки 05.11.2026): заявка, которую вернули на исправление и не исправили до
    // окончания комиссии, отклоняется автоматически вместе с её нерассмотренными участиями.
    this.competitions.registerEffect(async (ctx) => {
      if (ctx.from === 'REGISTRATION_CLOSED' && ctx.to === 'CHECK_IN') await this.rejectUnfixed(ctx);
      // Правки 09.11.2026: при окончании регистрации спортсмены без документов или с просроченными исключаются.
      if (ctx.from === 'REGISTRATION_OPEN' && ctx.to === 'REGISTRATION_CLOSED')
        await this.roster.removeNotReady(ctx.tx, ctx.competition, ctx.userId);
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

  private async rejectUnfixed(ctx: TransitionContext): Promise<void> {
    const { tx, competition, userId, now } = ctx;
    const apps = await tx.application.findMany({
      where: { competitionId: competition.id, status: 'WAITING_DOCUMENTS' },
      select: { id: true, organizationId: true },
    });
    for (const app of apps) {
      await tx.application.update({
        where: { id: app.id },
        data: {
          status: 'REJECTED',
          reviewedAt: now,
          reviewedById: userId,
          reviewComment: AUTO_REJECT_REASON,
          version: { increment: 1 },
        },
      });
      const entries = await tx.entry.findMany({
        where: { applicationId: app.id, status: 'PENDING' },
        select: { id: true },
      });
      await tx.entry.updateMany({
        where: { id: { in: entries.map((e) => e.id) } },
        data: {
          status: 'REJECTED',
          decidedAt: now,
          decidedById: userId,
          decisionReason: AUTO_REJECT_REASON,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'application.status_changed',
        entityType: 'Application',
        entityId: app.id,
        competitionId: competition.id,
        organizationId: app.organizationId,
        before: { status: 'WAITING_DOCUMENTS' },
        after: { status: 'REJECTED', entries: entries.length, trigger: 'mandate_commission_ended' },
        reason: AUTO_REJECT_REASON,
      });
      for (const e of entries)
        await this.outbox.enqueue(tx, {
          type: 'registration.entry_decided',
          aggregate: { type: 'Entry', id: e.id },
          competitionId: competition.id,
          payload: { entryId: e.id, decision: 'REJECTED' },
        });
      await this.outbox.enqueue(tx, {
        type: 'registration.application_decided',
        aggregate: { type: 'Application', id: app.id },
        competitionId: competition.id,
        payload: { applicationId: app.id, status: 'REJECTED' },
      });
    }
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
