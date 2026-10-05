// Команды расписания (Phase 6, §2–§4; API.md, 6.2; ARCHITECTURE.md, 14.6): генерация автопланировщиком, ручная
// правка пакетом (If-Match версии расписания, запреты — отказ, предупреждения — confirm: true), публикация.
// Блокировки: право записи → турнир FOR SHARE → строка расписания FOR UPDATE (schedule-locks.ts).
import { Injectable } from '@nestjs/common';
import type { PermissionCode, ScheduleDto, ScheduleGenerate, ScheduleItemsPatch } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { BracketsService } from '../../brackets';
import { CompetitionScopeService } from '../../competitions';
import { isStartedOrPlayed, MatchesService } from '../../matches';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import { type GenerateScheduleInput, generateSchedule } from '../domain/generator';
import { computeTimeline, type TimelineItem } from '../domain/timeline';
import {
  assembleSchedule,
  eligibleForScheduling,
  loadMinRestSeconds,
  toDate,
  toMatInputs,
  toSessionInputs,
} from './schedule-assembly';
import { lockCompetitionShared, lockOrCreateSchedule } from './schedule-locks';
import { ScheduleQueriesService } from './schedule-queries.service';

const CANDIDATES: readonly PermissionCode[] = ['schedule.manage', 'schedule.publish'];

@Injectable()
export class ScheduleService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly leases: WriteLeaseService,
    private readonly brackets: BracketsService,
    private readonly matches: MatchesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly queries: ScheduleQueriesService,
  ) {}

  /**
   * Автопланировщик (раздел 2): по умолчанию заполняет все сессии турнира; `sessionIds` — только их (уже
   * стоящие вне этой области схватки на этот прогон трактуются как закреплённые на своё текущее место — не
   * переезжают). `categoryPins` — закрепление категории за ковром на этот прогон (не хранится отдельно).
   */
  async generate(user: AuthUser, competitionId: string, req: ScheduleGenerate): Promise<ScheduleDto> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'schedule.manage', scope);
    const allowedActions = await this.policy.allowedActions(user, scope, CANDIDATES);

    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await lockCompetitionShared(tx, competitionId);
      const schedule = await lockOrCreateSchedule(tx, competitionId, null);

      const mats = await tx.mat.findMany({ where: { competitionId, isActive: true }, orderBy: { number: 'asc' } });
      const allSessions = await tx.session.findMany({ where: { competitionId }, orderBy: { startsAt: 'asc' } });
      const sessionScope = req.sessionIds ? new Set(req.sessionIds) : null;
      if (sessionScope) {
        const known = new Set(allSessions.map((s) => s.id));
        if (req.sessionIds?.some((id) => !known.has(id))) throw new DomainError('NOT_FOUND', { resource: 'session' });
      }
      const sessionsForGen = sessionScope ? allSessions.filter((s) => sessionScope.has(s.id)) : allSessions;

      const assembly = await assembleSchedule(tx, this.brackets, this.matches, competitionId);
      const minRestSeconds = await loadMinRestSeconds(tx, competitionId);

      const matIds = new Set(mats.map((m) => m.id));
      for (const pin of req.categoryPins) if (!matIds.has(pin.matId)) throw new DomainError('NOT_FOUND', { resource: 'mat' });
      const pinMap = new Map(req.categoryPins.map((p) => [p.categoryId, p.matId]));
      const categories = assembly.categories.map((c) => ({ ...c, pinnedMatId: pinMap.get(c.id) ?? null }));

      // Схватка вне области этого прогона, но уже стоящая в расписании, — временно закрепляется на своё текущее
      // место (генерация её не переставит), даже если не была отмечена «закреплено» вручную (план §4: уже
      // расставленные категории многодневного турнира при генерации следующего дня не двигаются).
      const existing = sessionScope
        ? await tx.matchSchedule.findMany({
            where: { matchId: { in: assembly.matches.map((m) => m.id) } },
            select: { matchId: true, sessionId: true, matId: true, orderInMat: true },
          })
        : [];
      const existingBy = new Map(existing.map((r) => [r.matchId, r]));
      const matches = assembly.matches.map((m) => {
        if (m.pinned || !sessionScope) return m;
        const cur = existingBy.get(m.id);
        if (cur && !sessionScope.has(cur.sessionId))
          return { ...m, pinned: { sessionId: cur.sessionId, matId: cur.matId, orderInMat: cur.orderInMat } };
        return m;
      });

      const input: GenerateScheduleInput = {
        sessions: toSessionInputs(sessionsForGen),
        mats: toMatInputs(mats),
        categories,
        matches,
        matChangeoverSeconds: schedule.matChangeoverSeconds,
        minRestSeconds,
        finalsBlock: req.finalsBlock,
      };
      const result = generateSchedule(input);

      const touchedIds = new Set(matches.filter((m) => !m.pinned).map((m) => m.id));
      if (touchedIds.size > 0) {
        await tx.matchSchedule.deleteMany({ where: { matchId: { in: [...touchedIds] } } });
        const toCreate = result.placements.filter((p) => touchedIds.has(p.matchId));
        if (toCreate.length > 0) {
          await tx.matchSchedule.createMany({
            data: toCreate.map((p) => ({
              id: uuidv7(),
              competitionId,
              matchId: p.matchId,
              sessionId: p.sessionId,
              matId: p.matId,
              orderInMat: p.orderInMat,
              plannedAt: toDate(p.plannedAt),
              locked: false,
            })),
          });
        }
      }

      await this.audit.record(tx, {
        action: 'schedule.generated',
        entityType: 'Schedule',
        entityId: schedule.id,
        competitionId,
        after: {
          sessionIds: req.sessionIds ?? null,
          finalsBlock: req.finalsBlock,
          placed: result.placements.length,
          unassigned: result.unassigned.length,
        },
        platformIntervention: viaPlatform,
      });
    });

    return this.queries.build(this.db, competitionId, allowedActions);
  }

  /**
   * Ручная правка пакетом (раздел 3): запреты — до дедлайна зависимости (SCHEDULE_ORDER_VIOLATION) и перенос
   * начатой/сыгранной схватки (MATCH_ALREADY_STARTED) — отказ без возможности подтверждения; отдых меньше
   * минимального и переполнение сессии — предупреждения, отказ с SCHEDULE_CONFIRM_REQUIRED, пока не confirm: true.
   * Время всех схваток пересчитывается по порядку на ковре (computeTimeline), не только у переставленных.
   */
  async patchItems(
    user: AuthUser,
    competitionId: string,
    version: number,
    req: ScheduleItemsPatch,
  ): Promise<ScheduleDto> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'schedule.manage', scope);
    const allowedActions = await this.policy.allowedActions(user, scope, CANDIDATES);

    const matchIds = req.moves.map((m) => m.matchId);
    if (new Set(matchIds).size !== matchIds.length)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'moves', code: 'duplicate_match' }] });

    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await lockCompetitionShared(tx, competitionId);
      const schedule = await lockOrCreateSchedule(tx, competitionId, version);

      const assembly = await assembleSchedule(tx, this.brackets, this.matches, competitionId);
      const minRestSeconds = await loadMinRestSeconds(tx, competitionId);
      const inputByMatch = new Map(assembly.matches.map((m) => [m.id, m]));

      for (const move of req.moves) {
        const match = assembly.matchById.get(move.matchId);
        if (!match || !eligibleForScheduling(match))
          throw new DomainError('NOT_FOUND', { resource: 'match' });
        if (isStartedOrPlayed(match)) throw new DomainError('MATCH_ALREADY_STARTED', { matchId: move.matchId });
      }

      const matIds = [...new Set(req.moves.map((m) => m.matId))];
      const sessionIds = [...new Set(req.moves.map((m) => m.sessionId))];
      const [mats, matchedSessions, allSessions] = await Promise.all([
        tx.mat.findMany({ where: { id: { in: matIds }, competitionId } }),
        tx.session.findMany({ where: { id: { in: sessionIds }, competitionId } }),
        tx.session.findMany({ where: { competitionId }, orderBy: { startsAt: 'asc' } }),
      ]);
      if (mats.length !== matIds.length) throw new DomainError('NOT_FOUND', { resource: 'mat' });
      if (matchedSessions.length !== sessionIds.length) throw new DomainError('NOT_FOUND', { resource: 'session' });

      const existingItems = await tx.matchSchedule.findMany({ where: { competitionId } });
      const beforeById = new Map(existingItems.map((r) => [r.matchId, r]));
      const moveByMatch = new Map(req.moves.map((m) => [m.matchId, m]));

      // Итоговое место каждой схватки после пакета: у переставленных — новое, у остальных — прежнее. Дважды
      // одно и то же место занять нельзя (DEFERRABLE-ограничение проверит финал при коммите, но людям — понятную
      // ошибку сразу).
      const finalSlot = new Map<string, { sessionId: string; matId: string; orderInMat: number }>();
      for (const row of existingItems) {
        const move = moveByMatch.get(row.matchId);
        finalSlot.set(row.matchId, move ? move : { sessionId: row.sessionId, matId: row.matId, orderInMat: row.orderInMat });
      }
      for (const move of req.moves) if (!finalSlot.has(move.matchId)) finalSlot.set(move.matchId, move);
      const seenSlots = new Map<string, string>();
      for (const [matchId, slot] of finalSlot) {
        const key = `${slot.sessionId}:${slot.matId}:${slot.orderInMat}`;
        const clash = seenSlots.get(key);
        if (clash && clash !== matchId)
          throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'moves', code: 'slot_taken' }] });
        seenSlots.set(key, matchId);
      }

      // Пересчёт времени по итоговой расстановке (только годные к расписанию схватки — «без схватки» не влияют
      // на очередь ковра и остаются на своём месте нетронутыми, схваткам с ними не занимаясь).
      const timelineItems: TimelineItem[] = [];
      for (const [matchId, slot] of finalSlot) {
        const input = inputByMatch.get(matchId);
        if (!input) continue;
        timelineItems.push({
          matchId,
          sessionId: slot.sessionId,
          matId: slot.matId,
          orderInMat: slot.orderInMat,
          durationSeconds: input.durationSeconds,
          dependsOn: input.dependsOn,
          athleteIds: input.athleteIds,
        });
      }
      const timeline = computeTimeline({
        items: timelineItems,
        sessions: toSessionInputs(allSessions),
        minRestSeconds,
        matChangeoverSeconds: schedule.matChangeoverSeconds,
      });
      if (timeline.orderViolations.length > 0)
        throw new DomainError('SCHEDULE_ORDER_VIOLATION', { violations: timeline.orderViolations });
      if (timeline.warnings.length > 0 && !req.confirm)
        throw new DomainError('SCHEDULE_CONFIRM_REQUIRED', { warnings: timeline.warnings });

      for (const p of timeline.placements) {
        const before = beforeById.get(p.matchId);
        const move = moveByMatch.get(p.matchId);
        const locked = move?.locked ?? before?.locked ?? false;
        if (before) {
          await tx.matchSchedule.update({
            where: { matchId: p.matchId },
            data: {
              sessionId: p.sessionId,
              matId: p.matId,
              orderInMat: p.orderInMat,
              plannedAt: toDate(p.plannedAt),
              locked,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.matchSchedule.create({
            data: {
              id: uuidv7(),
              competitionId,
              matchId: p.matchId,
              sessionId: p.sessionId,
              matId: p.matId,
              orderInMat: p.orderInMat,
              plannedAt: toDate(p.plannedAt),
              locked,
            },
          });
        }
      }
      await tx.schedule.update({ where: { id: schedule.id }, data: { version: { increment: 1 } } });

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const move of req.moves) {
        const prior = beforeById.get(move.matchId);
        before[move.matchId] = prior
          ? { sessionId: prior.sessionId, matId: prior.matId, orderInMat: prior.orderInMat, locked: prior.locked }
          : null;
        after[move.matchId] = {
          sessionId: move.sessionId,
          matId: move.matId,
          orderInMat: move.orderInMat,
          locked: move.locked ?? prior?.locked ?? false,
        };
      }
      await this.audit.record(tx, {
        action: 'schedule.items_moved',
        entityType: 'Schedule',
        entityId: schedule.id,
        competitionId,
        before,
        after,
        platformIntervention: viaPlatform,
      });

      await this.notifyChanged(tx, competitionId, [...finalSlot.keys()].filter((id) => moveByMatch.has(id)));
    });

    return this.queries.build(this.db, competitionId, allowedActions);
  }

  /**
   * Публикация (раздел 4): нельзя, пока есть схватки категорий с опубликованными сетками без места в расписании.
   * Турнир переходит DRAWING → SCHEDULED отдельной командой (schedule-lifecycle.ts проверяет это условие).
   */
  async publish(user: AuthUser, competitionId: string, version: number): Promise<ScheduleDto> {
    const scope = await this.competitions.scopeOf(competitionId);
    const { viaPlatform } = await this.policy.assert(user, 'schedule.publish', scope);
    const allowedActions = await this.policy.allowedActions(user, scope, CANDIDATES);

    await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      await lockCompetitionShared(tx, competitionId);
      const schedule = await lockOrCreateSchedule(tx, competitionId, version);
      if (schedule.status === 'PUBLISHED') throw new DomainError('SCHEDULE_ALREADY_PUBLISHED', {});

      const assembly = await assembleSchedule(tx, this.brackets, this.matches, competitionId);
      const scheduledIds = new Set(
        (
          await tx.matchSchedule.findMany({
            where: { matchId: { in: assembly.matches.map((m) => m.id) } },
            select: { matchId: true },
          })
        ).map((r) => r.matchId),
      );
      const unassignedCount = assembly.matches.filter((m) => !scheduledIds.has(m.id)).length;
      if (unassignedCount > 0) throw new DomainError('SCHEDULE_HAS_UNASSIGNED_MATCHES', { count: unassignedCount });

      await tx.schedule.update({
        where: { id: schedule.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: user.id, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'schedule.published',
        entityType: 'Schedule',
        entityId: schedule.id,
        competitionId,
        before: { status: schedule.status },
        after: { status: 'PUBLISHED' },
        platformIntervention: viaPlatform,
      });
      await this.outbox.enqueue(tx, {
        type: 'schedule.published',
        aggregate: { type: 'Schedule', id: schedule.id },
        payload: { competitionId },
        competitionId,
      });
    });

    return this.queries.build(this.db, competitionId, allowedActions);
  }

  /**
   * После публикации изменение мест схваток уходит клубам их участников одним событием на пакет
   * (план §4: правки за 10 минут сливаются в одно уведомление — worker/notification.consumer.ts).
   */
  private async notifyChanged(tx: Tx, competitionId: string, matchIds: string[]): Promise<void> {
    if (matchIds.length === 0) return;
    const schedule = await tx.schedule.findUnique({ where: { competitionId }, select: { status: true } });
    if (schedule?.status !== 'PUBLISHED') return;
    await this.outbox.enqueue(tx, {
      type: 'schedule.changed',
      aggregate: { type: 'Schedule', id: competitionId },
      payload: { competitionId, matchIds },
      competitionId,
    });
  }
}
