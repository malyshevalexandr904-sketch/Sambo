// Итоги категории (план Phase 7b, §1): завершение категории последним подтверждённым исходом сетки, места и медали
// по правилу формата (Q-13), публикация результатов и история спортсменов, пересчёт после изменения результата.
// Пересчёт вызывают команды судейства под блокировками категории и жеребьёвки (порядок «категория → жеребьёвка →
// схватка»); публикация — своя команда под блокировкой категории.
import { Injectable } from '@nestjs/common';
import { type CategoryResultStatus, medalForPlace } from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { BracketsService, type Placement } from '../../brackets';
import { CategoryWorkflowService, type LockedCategory } from '../../categories';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

/** Опубликованные итоги (в том числе изменённые после публикации): попадают в историю спортсменов. */
const isPublished = (status: CategoryResultStatus): boolean => status === 'PUBLISHED' || status === 'AMENDED';

const samePlacements = (
  a: readonly { entryId: string; place: number; wins: number; losses: number }[],
  b: readonly Placement[],
): boolean => {
  if (a.length !== b.length) return false;
  const byEntry = new Map(a.map((p) => [p.entryId, p]));
  return b.every((p) => {
    const x = byEntry.get(p.entryId);
    return !!x && x.place === p.place && x.wins === p.wins && x.losses === p.losses;
  });
};

@Injectable()
export class CategoryResultsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly brackets: BracketsService,
    private readonly categories: CategoryWorkflowService,
    private readonly competitions: CompetitionScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Итоги после изменения сетки (подтверждение, автоматическая неявка, изменение результата). Сетка завершена —
   * категория `→ COMPLETED` (из DRAWN — через IN_PROGRESS), места и медали записываются; у опубликованной категории
   * места обновляются (`AMENDED`) вместе с историей спортсменов. Изменение открыло новые схватки — неопубликованная
   * категория возвращается в IN_PROGRESS, опубликованную так менять нельзя.
   */
  async refresh(tx: Tx, locked: LockedCategory, drawId: string): Promise<void> {
    const standing = await this.brackets.standing(tx, drawId);
    if (!standing) return;
    if (!standing.complete || !standing.placements) {
      await this.reopen(tx, locked);
      return;
    }
    if (locked.category.status === 'DRAWN') await this.categories.systemTransition(tx, locked, 'IN_PROGRESS');
    if (locked.category.status === 'IN_PROGRESS') {
      await this.categories.systemTransition(tx, locked, 'COMPLETED');
      await this.outbox.enqueue(tx, {
        type: 'category.completed',
        aggregate: { type: 'CompetitionCategory', id: locked.category.id },
        competitionId: locked.category.competitionId,
        payload: { categoryId: locked.category.id, competitionId: locked.category.competitionId },
      });
    }
    await this.write(tx, locked, drawId, standing.placements);
  }

  private async reopen(tx: Tx, locked: LockedCategory): Promise<void> {
    const status = locked.category.status;
    if (status === 'RESULTS_PUBLISHED') throw blocked('results_published_bracket_reopens');
    if (status !== 'COMPLETED') return;
    await tx.categoryResult.deleteMany({ where: { categoryId: locked.category.id } });
    await this.categories.systemTransition(tx, locked, 'IN_PROGRESS', 'result_amended');
  }

  /** Места и медали: новые — PROVISIONAL; изменились у опубликованных — AMENDED и история спортсменов. */
  private async write(
    tx: Tx,
    locked: LockedCategory,
    drawId: string,
    placements: Placement[],
  ): Promise<void> {
    const { id: categoryId, competitionId } = locked.category;
    const existing = await tx.categoryResult.findUnique({
      where: { categoryId },
      include: { placements: true },
    });
    if (existing && samePlacements(existing.placements, placements)) return;
    const now = new Date();
    const published = !!existing && isPublished(existing.status);
    const result = existing
      ? await tx.categoryResult.update({
          where: { id: existing.id },
          data: {
            drawId,
            computedAt: now,
            ...(published ? { status: 'AMENDED' as const, amendedAt: now } : {}),
            version: { increment: 1 },
          },
        })
      : await tx.categoryResult.create({
          data: { id: uuidv7(), competitionId, categoryId, drawId, computedAt: now },
        });
    await tx.placement.deleteMany({ where: { categoryResultId: result.id } });
    await tx.placement.createMany({
      data: placements.map((p) => ({
        id: uuidv7(),
        competitionId,
        categoryResultId: result.id,
        entryId: p.entryId,
        place: p.place,
        medal: medalForPlace(p.place),
        wins: p.wins,
        losses: p.losses,
      })),
    });
    if (published) await this.writeHistory(tx, result.id, 'AMENDED', existing?.publishedAt ?? now);
    await this.audit.record(tx, {
      action: published ? 'category.results_amended' : 'category.results_computed',
      entityType: 'CompetitionCategory',
      entityId: categoryId,
      competitionId,
      before: existing ? { places: existing.placements.map((p) => [p.entryId, p.place]) } : null,
      after: { status: result.status, places: placements.map((p) => [p.entryId, p.place]) },
    });
    if (published)
      await this.outbox.enqueue(tx, {
        type: 'category.results_amended',
        aggregate: { type: 'CompetitionCategory', id: categoryId },
        competitionId,
        payload: { categoryId, competitionId },
      });
  }

  /** История спортсменов по итогам категории: снимок турнира и категории на момент публикации. */
  private async writeHistory(
    tx: Tx,
    categoryResultId: string,
    status: 'PUBLISHED' | 'AMENDED',
    publishedAt: Date,
  ): Promise<void> {
    const result = await tx.categoryResult.findUniqueOrThrow({
      where: { id: categoryResultId },
      include: {
        placements: { include: { entry: { select: { athleteId: true, snapClubName: true } } } },
        category: { select: { nameRu: true, nameEn: true } },
        competition: { select: { name: true, startDate: true, endDate: true, level: true } },
      },
    });
    for (const p of result.placements) {
      const data = {
        athleteId: p.entry.athleteId,
        competitionId: result.competitionId,
        categoryId: result.categoryId,
        categoryResultId,
        competitionName: result.competition.name,
        competitionStartDate: result.competition.startDate,
        competitionEndDate: result.competition.endDate,
        competitionLevel: result.competition.level,
        categoryNameRu: result.category.nameRu,
        categoryNameEn: result.category.nameEn,
        clubName: p.entry.snapClubName,
        place: p.place,
        medal: p.medal,
        wins: p.wins,
        losses: p.losses,
        status,
        publishedAt,
      } satisfies Omit<Prisma.AthleteResultUncheckedCreateInput, 'id' | 'entryId'>;
      await tx.athleteResult.upsert({
        where: { entryId: p.entryId },
        create: { id: uuidv7(), entryId: p.entryId, ...data },
        update: data,
      });
    }
  }

  /**
   * Публикация результатов категории (`result.publish`, If-Match — версия итогов): только завершённая категория
   * (RESULT_NOT_CONFIRMED — есть неподтверждённые схватки); результаты схваток CONFIRMED → PUBLISHED, итоги —
   * PUBLISHED, история спортсменов, категория → RESULTS_PUBLISHED.
   */
  async publish(user: AuthUser, categoryId: string, version: number): Promise<void> {
    const category = await this.categories.require(categoryId);
    const scope = await this.competitions.scopeOf(category.competitionId);
    const access = await this.policy.assert(user, 'result.publish', scope);
    await this.db.tx(async (tx) => {
      const locked = await this.categories.lockForCommand(tx, categoryId);
      const status = locked.category.status;
      if (status === 'RESULTS_PUBLISHED')
        throw new DomainError('INVALID_TRANSITION', { from: status, to: 'RESULTS_PUBLISHED', allowed: [] });
      const result = await tx.categoryResult.findUnique({ where: { categoryId } });
      if (status !== 'COMPLETED' || !result) {
        const awaiting = await tx.matchResult.count({
          where: { status: 'PROVISIONAL', match: { categoryId } },
        });
        throw new DomainError('RESULT_NOT_CONFIRMED', {
          categoryStatus: status,
          awaitingConfirmation: awaiting,
        });
      }
      if (result.version !== version) throw versionConflict(result.version);
      const now = new Date();
      await tx.categoryResult.update({
        where: { id: result.id },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.id, version: { increment: 1 } },
      });
      await tx.matchResult.updateMany({
        where: { status: 'CONFIRMED', match: { categoryId } },
        data: { status: 'PUBLISHED', version: { increment: 1 } },
      });
      await this.writeHistory(tx, result.id, 'PUBLISHED', now);
      await this.categories.systemTransition(tx, locked, 'RESULTS_PUBLISHED');
      await this.audit.record(tx, {
        action: 'category.results_published',
        entityType: 'CompetitionCategory',
        entityId: categoryId,
        competitionId: category.competitionId,
        after: { status: 'PUBLISHED' },
        platformIntervention: access.viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'category.results_published',
        aggregate: { type: 'CompetitionCategory', id: categoryId },
        competitionId: category.competitionId,
        payload: { categoryId, competitionId: category.competitionId },
      });
    });
  }
}
