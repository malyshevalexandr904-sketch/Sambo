// Неявка снятого после жеребьёвки участника (ARCHITECTURE.md, 16.3; план Phase 7a, §3): как только соперник
// известен, снятый проигрывает схватку неявкой без судьи — в том числе в утешительных; сняты оба — схватка не
// проводится, оба проигравшие. Исход подтверждает система, сетка продвигается сразу. Срабатывает при снятии
// участия (подписчик события в той же транзакции) и после каждого подтверждённого результата сетки (соперник
// стал известен). Блокировки: категория (держит команда), жеребьёвка, затем схватки — как у подтверждения.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Side } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { AuditService } from '../../audit';
import { BracketsService } from '../../brackets';
import { entryOn, MatchStoreService } from '../../matches';
import { OutboxService } from '../../outbox';
import { ActiveMatchService } from '../../registrations';

/** Предел шагов: каждое продвижение может открыть новую схватку со снятым участником (утешительные). */
const MAX_ROUNDS = 64;

@Injectable()
export class WithdrawalsService implements OnModuleInit {
  constructor(
    private readonly brackets: BracketsService,
    private readonly store: MatchStoreService,
    private readonly activeMatch: ActiveMatchService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.subscribe('registration.entry_withdrawn', (tx, event) =>
      this.onWithdrawn(tx, event.payload.entryId),
    );
  }

  /** Участие снято (команда снятия держит блокировку категории): неявки по опубликованной сетке категории. */
  private async onWithdrawn(tx: Tx, entryId: string): Promise<void> {
    const entry = await tx.entry.findUnique({ where: { id: entryId }, select: { categoryId: true } });
    if (!entry) return;
    const drawId = await this.brackets.publishedDrawOfCategory(tx, entry.categoryId);
    if (!drawId || !(await this.brackets.lockDraw(tx, drawId))) return;
    await this.resolve(tx, drawId);
  }

  /**
   * Неявки по сетке жеребьёвки (заблокирована вызывающим): несыгранные схватки, где оба участника известны и хотя бы
   * один снят, — результат NO_SHOW, подтверждённый системой; затем продвижение, пока такие схватки появляются.
   */
  async resolve(tx: Tx, drawId: string): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const nodeIds = await this.brackets.nodeIdsOfDraw(tx, drawId);
      const candidates = await this.store.unstartedWithWithdrawn(tx, nodeIds);
      if (candidates.length === 0) break;
      for (const c of candidates) {
        const m = await this.store.lock(tx, c.id);
        if (m.status !== 'SCHEDULED' && m.status !== 'READY') continue;
        const red = entryOn(m, 'RED');
        const blue = entryOn(m, 'BLUE');
        if (!red || !blue) continue;
        const readiness = new Map(
          (await this.activeMatch.readiness(tx, [red, blue])).map((r) => [r.entryId, r.status]),
        );
        const redOut = readiness.get(red) === 'WITHDRAWN';
        const blueOut = readiness.get(blue) === 'WITHDRAWN';
        if (!redOut && !blueOut) continue;
        const winnerSide: Side | null = redOut && blueOut ? null : redOut ? 'BLUE' : 'RED';
        await this.store.systemNoShow(tx, m, winnerSide, 'participant_withdrawn');
        await this.audit.record(tx, {
          action: 'match.no_show_auto',
          entityType: 'Match',
          entityId: m.id,
          competitionId: m.competitionId,
          before: { status: m.status },
          after: { status: 'FINISHED', result: 'CONFIRMED', method: 'NO_SHOW', winnerSide },
          reason: 'participant_withdrawn',
        });
        await this.outbox.enqueue(tx, {
          type: 'match.result_confirmed',
          aggregate: { type: 'Match', id: m.id },
          competitionId: m.competitionId,
          payload: { matchId: m.id, categoryId: m.categoryId, winnerSide, method: 'NO_SHOW' },
        });
        total += 1;
      }
      await this.brackets.propagate(tx, drawId);
    }
    return total;
  }
}
