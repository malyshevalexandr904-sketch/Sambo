// Весы и окна взвешивания турнира (API.md, 5.6; D-06): настраиваются до окончания соревнований. Официальные
// окна одной категории не пересекаются; весы и окна с попытками не удаляются (история взвешивания).
import { Injectable } from '@nestjs/common';
import {
  type CompetitionStatus,
  type ScaleDto,
  type ScaleInput,
  type ScalePatch,
  todayIn,
  type WeighInWindowDto,
  type WeighInWindowInput,
  type WeighInWindowPatch,
} from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { toCategoryRef } from '../../admission';
import { AuditService } from '../../audit';
import { WriteLeaseService } from '../../venue-sync';
import { overlappingWindow, windowOpen } from '../domain/weighin-rules';

const CLOSED: readonly CompetitionStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];

const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

const invalid = (path: string, code: string): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields: [{ path, code }] });

@Injectable()
export class WeighInSetupService {
  constructor(
    private readonly db: PrismaService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
  ) {}

  /** Право записи и турнир не закрыт; возвращает часовой пояс турнира. */
  private async lockOpen(tx: Tx, competitionId: string): Promise<string> {
    await this.leases.assertWritable(tx, competitionId);
    const rows = await tx.$queryRaw<{ status: CompetitionStatus; timezone: string }[]>`
      SELECT status, timezone FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR SHARE`;
    const c = rows[0];
    if (!c) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    if (CLOSED.includes(c.status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['competition_closed'] });
    return c.timezone;
  }

  /**
   * Изменения окон турнира — по очереди (advisory-блокировка транзакции): иначе два параллельных запроса
   * прошли бы проверку пересечения каждый по своему снимку.
   */
  private async lockWindows(tx: Tx, competitionId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weigh_in_windows:${competitionId}`}))`;
  }

  // ---------- Весы ----------

  async scales(competitionId: string): Promise<ScaleDto[]> {
    const c = await this.db.competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: { timezone: true },
    });
    const today = todayIn(c.timezone);
    const rows = await this.db.scale.findMany({ where: { competitionId }, orderBy: { createdAt: 'asc' } });
    return rows.map((s) => {
      const verifiedUntil = s.verifiedUntil.toISOString().slice(0, 10);
      return {
        id: s.id,
        name: s.name,
        serialNumber: s.serialNumber,
        verifiedUntil,
        verified: verifiedUntil >= today,
      };
    });
  }

  async createScale(competitionId: string, input: ScaleInput): Promise<ScaleDto[]> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      const scale = await tx.scale.create({
        data: {
          id: uuidv7(),
          competitionId,
          name: input.name,
          serialNumber: input.serialNumber ?? null,
          verifiedUntil: toDate(input.verifiedUntil),
        },
      });
      await this.audit.record(tx, {
        action: 'scale.created',
        entityType: 'Scale',
        entityId: scale.id,
        competitionId,
        after: { name: input.name, verifiedUntil: input.verifiedUntil },
      });
    });
    return this.scales(competitionId);
  }

  async updateScale(competitionId: string, scaleId: string, patch: ScalePatch): Promise<ScaleDto[]> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      const scale = await tx.scale.findFirst({ where: { id: scaleId, competitionId } });
      if (!scale) throw new DomainError('NOT_FOUND', { resource: 'scale' });
      await tx.scale.update({
        where: { id: scaleId },
        data: {
          name: patch.name,
          serialNumber: patch.serialNumber,
          verifiedUntil: patch.verifiedUntil ? toDate(patch.verifiedUntil) : undefined,
        },
      });
      await this.audit.record(tx, {
        action: 'scale.updated',
        entityType: 'Scale',
        entityId: scaleId,
        competitionId,
        before: { name: scale.name, verifiedUntil: scale.verifiedUntil.toISOString().slice(0, 10) },
        after: { name: patch.name, verifiedUntil: patch.verifiedUntil },
      });
    });
    return this.scales(competitionId);
  }

  async deleteScale(competitionId: string, scaleId: string): Promise<void> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      const scale = await tx.scale.findFirst({ where: { id: scaleId, competitionId } });
      if (!scale) throw new DomainError('NOT_FOUND', { resource: 'scale' });
      if (await tx.weighInAttempt.count({ where: { scaleId } }))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['scale_has_attempts'] });
      await tx.scale.delete({ where: { id: scaleId } });
      await this.audit.record(tx, {
        action: 'scale.deleted',
        entityType: 'Scale',
        entityId: scaleId,
        competitionId,
        before: { name: scale.name },
      });
    });
  }

  // ---------- Окна ----------

  async windows(competitionId: string): Promise<WeighInWindowDto[]> {
    const now = new Date();
    const rows = await this.db.weighInWindow.findMany({
      where: { competitionId },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: {
        categories: {
          include: {
            category: { select: { id: true, code: true, nameRu: true, nameEn: true, sortOrder: true } },
          },
        },
        _count: { select: { attempts: true } },
      },
    });
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      kind: w.kind,
      categories: w.categories
        .map((c) => c.category)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
        .map(toCategoryRef),
      open: windowOpen(w, now),
      attempts: w._count.attempts,
    }));
  }

  /** Категории окна — действующие категории этого турнира; окна одного вида не пересекаются по категории. */
  private async assertWindow(
    tx: Tx,
    competitionId: string,
    w: { id: string; kind: 'OFFICIAL' | 'CONTROL'; startsAt: Date; endsAt: Date; categoryIds: string[] },
  ): Promise<void> {
    const ids = [...new Set(w.categoryIds)];
    const found = await tx.competitionCategory.count({
      where: { competitionId, id: { in: ids }, status: { notIn: ['MERGED', 'CANCELLED'] } },
    });
    if (found !== ids.length) throw invalid('categoryIds', 'category_not_found');
    const others = await tx.weighInWindow.findMany({
      where: { competitionId, kind: w.kind, id: { not: w.id } },
      include: { categories: { select: { categoryId: true } } },
    });
    const clash = overlappingWindow(
      { ...w, categoryIds: ids },
      others.map((o) => ({ ...o, categoryIds: o.categories.map((c) => c.categoryId) })),
    );
    if (clash)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'startsAt', code: 'window_overlap' }],
        windowId: clash.id,
      });
  }

  private async setCategories(
    tx: Tx,
    competitionId: string,
    windowId: string,
    categoryIds: string[],
  ): Promise<void> {
    await tx.weighInWindowCategory.deleteMany({ where: { windowId, categoryId: { notIn: categoryIds } } });
    await tx.weighInWindowCategory.createMany({
      data: [...new Set(categoryIds)].map((categoryId) => ({
        id: uuidv7(),
        competitionId,
        windowId,
        categoryId,
      })),
      skipDuplicates: true,
    });
  }

  async createWindow(competitionId: string, input: WeighInWindowInput): Promise<WeighInWindowDto[]> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      await this.lockWindows(tx, competitionId);
      const id = uuidv7();
      const period = { startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
      await this.assertWindow(tx, competitionId, {
        id,
        kind: input.kind,
        ...period,
        categoryIds: input.categoryIds,
      });
      await tx.weighInWindow.create({
        data: { id, competitionId, name: input.name, kind: input.kind, ...period },
      });
      await this.setCategories(tx, competitionId, id, input.categoryIds);
      await this.audit.record(tx, {
        action: 'weigh_in_window.created',
        entityType: 'WeighInWindow',
        entityId: id,
        competitionId,
        after: {
          name: input.name,
          kind: input.kind,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          categories: input.categoryIds.length,
        },
      });
    });
    return this.windows(competitionId);
  }

  async updateWindow(
    competitionId: string,
    windowId: string,
    patch: WeighInWindowPatch,
  ): Promise<WeighInWindowDto[]> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      await this.lockWindows(tx, competitionId);
      const current = await tx.weighInWindow.findFirst({
        where: { id: windowId, competitionId },
        include: { categories: { select: { categoryId: true } } },
      });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'weigh_in_window' });
      const next = {
        id: windowId,
        kind: patch.kind ?? current.kind,
        startsAt: patch.startsAt ? new Date(patch.startsAt) : current.startsAt,
        endsAt: patch.endsAt ? new Date(patch.endsAt) : current.endsAt,
        categoryIds: patch.categoryIds ?? current.categories.map((c) => c.categoryId),
      };
      if (next.endsAt <= next.startsAt) throw invalid('endsAt', 'period_invalid');
      await this.assertWindow(tx, competitionId, next);
      await tx.weighInWindow.update({
        where: { id: windowId },
        data: { name: patch.name, kind: next.kind, startsAt: next.startsAt, endsAt: next.endsAt },
      });
      if (patch.categoryIds) await this.setCategories(tx, competitionId, windowId, patch.categoryIds);
      await this.audit.record(tx, {
        action: 'weigh_in_window.updated',
        entityType: 'WeighInWindow',
        entityId: windowId,
        competitionId,
        before: {
          name: current.name,
          startsAt: current.startsAt.toISOString(),
          endsAt: current.endsAt.toISOString(),
        },
        after: {
          name: patch.name,
          startsAt: patch.startsAt,
          endsAt: patch.endsAt,
          categories: patch.categoryIds?.length,
        },
      });
    });
    return this.windows(competitionId);
  }

  async deleteWindow(competitionId: string, windowId: string): Promise<void> {
    await this.db.tx(async (tx) => {
      await this.lockOpen(tx, competitionId);
      const current = await tx.weighInWindow.findFirst({ where: { id: windowId, competitionId } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'weigh_in_window' });
      if (await tx.weighInAttempt.count({ where: { windowId } }))
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['window_has_attempts'] });
      await tx.weighInWindow.delete({ where: { id: windowId } });
      await this.audit.record(tx, {
        action: 'weigh_in_window.deleted',
        entityType: 'WeighInWindow',
        entityId: windowId,
        competitionId,
        before: { name: current.name },
      });
    });
  }
}
