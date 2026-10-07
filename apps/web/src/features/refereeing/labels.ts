'use client';
// Подписи судейства: коды действий и наказаний из правил турнира (правила — данные: незнакомый код показываем как
// есть, с ценностью), способы победы, стороны, причины отказа.
import type {
  MatchRulesDto,
  ProposedOutcome,
  ScoringRules,
  Side,
  TieBreaker,
  WinMethod,
} from '@sde/contracts';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

export function useRefereeLabels() {
  const t = useTranslations('referee');
  const code = useCallback(
    (c: string | null | undefined, points?: number | null): string => {
      if (!c) return '';
      if (t.has(`codes.${c}`)) return t(`codes.${c}`);
      return points ? `${c.replaceAll('_', ' ')} · ${points}` : c.replaceAll('_', ' ');
    },
    [t],
  );
  const side = useCallback((s: Side): string => t(s === 'RED' ? 'red' : 'blue'), [t]);
  const method = useCallback(
    (m: WinMethod, detail?: string | null): string => {
      const base = t(`methods.${m}`);
      if (!detail) return base;
      if (t.has(`tieBreakers.${detail}`)) return `${base} (${t(`tieBreakers.${detail}`)})`;
      if (detail === 'BOTH') return base;
      return `${base} (${code(detail)})`;
    },
    [t, code],
  );
  const proposal = useCallback(
    (p: ProposedOutcome): string =>
      p.winnerSide ? `${side(p.winnerSide)}: ${method(p.method, p.methodDetail)}` : t('decisionNeeded'),
    [t, side, method],
  );
  const rejection = useCallback(
    (reason: unknown): string =>
      typeof reason !== 'string' ? '' : t.has(`rejections.${reason}`) ? t(`rejections.${reason}`) : reason,
    [t],
  );
  const precondition = useCallback(
    (failed: unknown): string =>
      Array.isArray(failed)
        ? failed
            .map((f) =>
              typeof f === 'string' && t.has(`preconditions.${f}`) ? t(`preconditions.${f}`) : String(f),
            )
            .join('; ')
        : '',
    [t],
  );
  return { code, side, method, proposal, rejection, precondition };
}

/** Ценность действия по правилам (для подписи кнопки). */
export const actionPoints = (rules: MatchRulesDto, code: string): number | null =>
  rules.actions.find((a) => a.code === code)?.points ?? null;

/** Время M:SS. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Правила планшета (DTO схватки) → правила счёта для предпросмотра тем же редьюсером, что на сервере. */
export function toScoringRules(r: MatchRulesDto): ScoringRules {
  return {
    actions: r.actions.map((a) =>
      a.totalVictory
        ? { code: a.code, kind: 'TOTAL_VICTORY' as const }
        : { code: a.code, points: a.points ?? 0 },
    ),
    penalties: r.penalties.map((p) =>
      p.disqualification
        ? { code: p.code, kind: 'DISQUALIFICATION' as const }
        : { code: p.code, opponentPoints: p.opponentPoints ?? 0 },
    ),
    hold: { thresholds: r.hold.thresholds, maxPerMatch: r.hold.maxPerMatch },
    superiorityPoints: r.superiorityPoints,
    tieBreakers: r.tieBreakers as TieBreaker[],
  };
}
