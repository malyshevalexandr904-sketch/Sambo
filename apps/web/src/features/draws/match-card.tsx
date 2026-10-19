'use client';
// Карточка схватки сетки: стороны с участниками или источником («Победитель № 7», «1-е место подгруппы А»), счёт,
// номер схватки со ссылкой и ход схватки. Общая для всех видов сетки (bracket-view).
import type {
  BracketNodeDto,
  BracketSideDto,
  BracketViewDto,
  DrawParticipantDto,
  Side,
} from '@sde/contracts';
import { Badge, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Link } from '@/i18n/navigation';

export interface Ctx {
  participants: Map<string, DrawParticipantDto>;
  nodes: Map<string, BracketNodeDto>;
  /** Ссылка на страницу схватки (опубликованная сетка, Phase 7b). */
  matchHref?: (matchId: string) => string;
}

export function useCtx(view: BracketViewDto, matchHref?: (matchId: string) => string): Ctx {
  return useMemo(
    () => ({
      participants: new Map(view.participants.map((p) => [p.entryId, p])),
      nodes: new Map(view.nodes.map((n) => [n.key, n])),
      matchHref,
    }),
    [view, matchHref],
  );
}

/** Кто займёт сторону, пока участник не известен: «Победитель № 7», проигравший победителю подгруппы. */
function useSourceText(ctx: Ctx): (s: BracketSideDto) => string {
  const t = useTranslations('bracket');
  const letters = useTranslations('draws.ratedPlan.letters');
  return (s) => {
    if (s.bye) return t('bye');
    if (s.source.type === 'WINNER_OF') {
      const number = ctx.nodes.get(s.source.ref)?.match?.number;
      return number ? t('waitingWinner', { number }) : t('waiting');
    }
    if (s.source.type === 'DYNAMIC') {
      const [, pool, round] = s.source.ref.split(':');
      return t('waitingDynamic', { pool: pool ?? '', round: round ?? '' });
    }
    if (s.source.type === 'POOL_RANK') {
      const [group, place] = s.source.ref.split(':');
      return t('waitingPoolRank', { group: letters(group ?? 'A'), place: place ?? '' });
    }
    return t('waiting');
  };
}

function SideRow({ node, side, ctx }: { node: BracketNodeDto; side: Side; ctx: Ctx }) {
  const t = useTranslations('bracket');
  const describe = useSourceText(ctx);
  const s = side === 'RED' ? node.red : node.blue;
  const p = s.entryId ? ctx.participants.get(s.entryId) : undefined;
  const won = node.winnerSide === side && node.status === 'DECIDED';
  const r = node.match?.result;
  const score =
    r && r.method !== 'BYE' && r.method !== 'NO_SHOW' ? (side === 'RED' ? r.redScore : r.blueScore) : null;
  const lost = node.status === 'DECIDED' && node.winnerSide !== null && node.winnerSide !== side;
  return (
    <div
      className={cn(
        'flex min-h-10 items-center gap-2 border-l-4 px-2 py-1 print:min-h-0 print:py-0',
        side === 'RED' ? 'border-red-600' : 'border-blue-600',
        lost && 'text-slate-400',
      )}
    >
      <span className="sr-only">{t(side === 'RED' ? 'red' : 'blue')}: </span>
      {p ? (
        <span className={cn('min-w-0 flex-1 print:truncate', won && 'font-semibold')}>
          <span className="block truncate print:inline">
            {p.publicName}
            {won ? <span aria-label={t('winner')}> ✓</span> : null}
          </span>
          <span className="block truncate text-xs text-slate-500 print:ml-1 print:inline print:text-[9px]">
            {p.organization?.name ?? ''}
            {p.seedNumber ? ` · ${t('seed', { seed: p.seedNumber })}` : ''}
            {p.ratingAtDraw !== null ? ` · ${t('rating', { rating: p.ratingAtDraw })}` : ''}
          </span>
        </span>
      ) : (
        <span className="flex-1 text-xs italic text-slate-500 print:text-[9px]">{describe(s)}</span>
      )}
      {p?.entryStatus === 'WITHDRAWN' ? <Badge tone="warning">{t('withdrawn')}</Badge> : null}
      {score !== null ? (
        <span className={cn('font-mono tabular-nums', won && 'font-bold')}>{score}</span>
      ) : null}
    </div>
  );
}

/** Ход схватки в сетке (Phase 7a): идёт, пауза, вызвана, ждёт подтверждения; после подтверждения — способ победы. */
function MatchProgress({ node }: { node: BracketNodeDto }) {
  const t = useTranslations('referee');
  const m = node.match;
  if (!m) return null;
  if (m.result?.status === 'PROVISIONAL') return <Badge tone="warning">{t('awaitingConfirmation')}</Badge>;
  if (m.status === 'IN_PROGRESS') return <Badge tone="success">{t('matchStatuses.IN_PROGRESS')}</Badge>;
  if (m.status === 'PAUSED') return <Badge tone="warning">{t('matchStatuses.PAUSED')}</Badge>;
  if (m.status === 'READY') return <Badge tone="info">{t('matchStatuses.READY')}</Badge>;
  if (m.result && m.result.method !== 'BYE') return <span>{t(`methods.${m.result.method}`)}</span>;
  return null;
}

export function MatchCard({ node, ctx }: { node: BracketNodeDto; ctx: Ctx }) {
  const t = useTranslations('bracket');
  const number = node.match?.number ?? null;
  const title = number !== null ? t('match', { number }) : node.status === 'WALKOVER' ? t('walkover') : ' ';
  return (
    <article
      className="break-inside-avoid rounded-md border border-slate-200 bg-white text-sm shadow-sm print:rounded-sm print:text-[10px] print:shadow-none"
      aria-label={`${t(`rounds.${node.label}`)} ${number !== null ? t('match', { number }) : ''}`.trim()}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-0.5 text-xs text-slate-600 print:py-0 print:text-[9px]">
        {node.match && number !== null && ctx.matchHref ? (
          <Link
            href={ctx.matchHref(node.match.id)}
            className="font-medium text-blue-800 hover:underline print:text-inherit"
          >
            {title}
          </Link>
        ) : (
          <span className="font-medium">{title}</span>
        )}
        <span className="flex items-center gap-1">
          {node.placeForWinner === 3 ? <span>{t('forThird')}</span> : null}
          <MatchProgress node={node} />
        </span>
      </header>
      <SideRow node={node} side="RED" ctx={ctx} />
      <SideRow node={node} side="BLUE" ctx={ctx} />
    </article>
  );
}

export const byPosition = (a: BracketNodeDto, b: BracketNodeDto): number => a.position - b.position;
