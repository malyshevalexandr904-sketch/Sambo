// Схватка в командах и запросах судейства: область прав по схватке (резолвер «match», ресурс политик бригады),
// правила турнира (закреплённая версия неизменна — кэш по версии), журнал в виде событий счёта.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RuleSetParametersV1, type ScoringEvent } from '@sde/contracts';
import type { MatchEvent, Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type ResourceScope, ScopeResolverRegistry } from '../../access';
import { CompetitionScopeService } from '../../competitions';
import type { MatchRecord } from '../../matches';

export interface MatchHead {
  id: string;
  competitionId: string;
  categoryId: string;
  status: MatchRecord['status'];
}

/** Журнал схватки → события счёта (packages/contracts). */
export function toScoringEvents(rows: readonly MatchEvent[]): ScoringEvent[] {
  return rows.map((e) => ({
    id: e.id,
    seq: e.seq,
    type: e.type,
    side: e.side,
    actionCode: e.actionCode,
    value: e.value,
    matchClockMs: e.matchClockMs,
    deviceTime: e.deviceTime.toISOString(),
    voidsEventId: e.voidsEventId,
  }));
}

@Injectable()
export class MatchContextService implements OnModuleInit {
  /** Опубликованные версии правил неизменны (триггер БД): разобранные параметры кэшируются по id версии. */
  private readonly rulesCache = new Map<string, RuleSetParametersV1>();

  constructor(
    private readonly db: PrismaService,
    private readonly registry: ScopeResolverRegistry,
    private readonly competitions: CompetitionScopeService,
  ) {}

  onModuleInit(): void {
    // Область — турнир схватки; ресурс политик бригады (MAT_ASSIGNED, MAT_CHIEF) — сама схватка.
    this.registry.register('match', async (id) => {
      const head = await this.head(id);
      return {
        scopes: [await this.competitions.scopeOf(head.competitionId)],
        resource: { matchId: head.id },
      };
    });
  }

  /** Схватка без блокировки (до транзакции: право и переход); не найдена — 404. */
  async head(matchId: string | undefined, tx?: Tx): Promise<MatchHead> {
    const row = matchId
      ? await (tx ?? this.db).match.findUnique({
          where: { id: matchId },
          select: { id: true, competitionId: true, categoryId: true, status: true },
        })
      : null;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'match' });
    return row;
  }

  async scopeOf(competitionId: string): Promise<ResourceScope> {
    return this.competitions.scopeOf(competitionId);
  }

  /** Правила турнира (закреплённая версия). Без них счёт вести нельзя. */
  async rules(tx: Tx | null, competitionId: string): Promise<RuleSetParametersV1> {
    const competition = await (tx ?? this.db).competition.findUnique({
      where: { id: competitionId },
      select: { ruleSetVersionId: true },
    });
    const versionId = competition?.ruleSetVersionId;
    if (!versionId) throw new DomainError('RULESET_REQUIRED');
    const cached = this.rulesCache.get(versionId);
    if (cached) return cached;
    const version = await (tx ?? this.db).ruleSetVersion.findUnique({
      where: { id: versionId },
      select: { parameters: true, status: true },
    });
    const parsed = RuleSetParametersV1.safeParse(version?.parameters ?? null);
    if (!parsed.success) throw new Error(`Rule set version ${versionId} has invalid parameters`);
    if (version?.status !== 'DRAFT') this.rulesCache.set(versionId, parsed.data);
    return parsed.data;
  }
}
