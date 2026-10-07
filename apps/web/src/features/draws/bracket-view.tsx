'use client';
// Визуализация сетки (IMPLEMENTATION_PLAN, Phase 5): участники, номера схваток, победители, переходы, BYE,
// утешительные схватки, круговая таблица. На телефоне — вертикальный список кругов с переключателем
// (ARCHITECTURE.md, 23.3), на экране и в печати — дерево по кругам.
import type {
  BracketNodeDto,
  BracketSideDto,
  BracketViewDto,
  DrawParticipantDto,
  Side,
} from '@sde/contracts';
import { Badge, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

interface Ctx {
  participants: Map<string, DrawParticipantDto>;
  nodes: Map<string, BracketNodeDto>;
}

function useCtx(view: BracketViewDto): Ctx {
  return useMemo(
    () => ({
      participants: new Map(view.participants.map((p) => [p.entryId, p])),
      nodes: new Map(view.nodes.map((n) => [n.key, n])),
    }),
    [view],
  );
}

/** Кто займёт сторону, пока участник не известен: «Победитель № 7», проигравший победителю подгруппы. */
function useSourceText(ctx: Ctx): (s: BracketSideDto) => string {
  const t = useTranslations('bracket');
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

function MatchCard({ node, ctx }: { node: BracketNodeDto; ctx: Ctx }) {
  const t = useTranslations('bracket');
  const number = node.match?.number ?? null;
  const title = number !== null ? t('match', { number }) : node.status === 'WALKOVER' ? t('walkover') : ' ';
  return (
    <article
      className="break-inside-avoid rounded-md border border-slate-200 bg-white text-sm shadow-sm print:rounded-sm print:text-[10px] print:shadow-none"
      aria-label={`${t(`rounds.${node.label}`)} ${number !== null ? t('match', { number }) : ''}`.trim()}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-0.5 text-xs text-slate-600 print:py-0 print:text-[9px]">
        <span className="font-medium">{title}</span>
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

const byPosition = (a: BracketNodeDto, b: BracketNodeDto): number => a.position - b.position;

function RoundTabs({
  rounds,
  labels,
  current,
  onChange,
}: {
  rounds: number[];
  labels: Map<number, string>;
  current: number;
  onChange: (round: number) => void;
}) {
  const t = useTranslations('bracket');
  return (
    <div role="tablist" aria-label={t('rounds.label')} className="mb-3 flex gap-1 overflow-x-auto">
      {rounds.map((r) => (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={current === r}
          onClick={() => onChange(r)}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-3 text-sm',
            current === r ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white',
          )}
        >
          {labels.get(r)}
        </button>
      ))}
    </div>
  );
}

function EliminationView({ view }: { view: BracketViewDto }) {
  const t = useTranslations('bracket');
  const ctx = useCtx(view);
  const main = view.nodes.filter((n) => n.stage === 'MAIN');
  const rounds = [...new Set(main.map((n) => n.round))].sort((a, b) => a - b);
  const labels = new Map(
    rounds.map((r) => [r, t(`rounds.${main.find((n) => n.round === r)?.label ?? 'FINAL'}`)]),
  );
  const [round, setRound] = useState(rounds[0] ?? 1);
  const repechage = view.nodes.filter((n) => n.stage === 'REPECHAGE');
  return (
    <div className="space-y-6">
      <section aria-label={t('main')}>
        {view.format === 'ELIMINATION_WITH_REPECHAGE' && view.size >= 4 ? (
          <p className="mb-3 text-sm text-slate-600">{t('poolsHint')}</p>
        ) : null}
        <div className="md:hidden print:hidden">
          <RoundTabs rounds={rounds} labels={labels} current={round} onChange={setRound} />
          <ol className="space-y-2">
            {main
              .filter((n) => n.round === round)
              .sort(byPosition)
              .map((n) => (
                <li key={n.key}>
                  <MatchCard node={n} ctx={ctx} />
                </li>
              ))}
          </ol>
        </div>
        <div className="hidden overflow-x-auto pb-2 md:block print:block print:overflow-visible">
          <div className="flex min-w-max items-stretch gap-3 print:gap-2">
            {rounds.map((r) => (
              <section key={r} className="flex w-48 flex-col print:w-40" aria-label={labels.get(r)}>
                <h4 className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {labels.get(r)}
                </h4>
                <ol className="flex flex-1 flex-col justify-around gap-3 print:gap-0.5">
                  {main
                    .filter((n) => n.round === r)
                    .sort(byPosition)
                    .map((n) => (
                      <li key={n.key}>
                        <MatchCard node={n} ctx={ctx} />
                      </li>
                    ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </section>
      {repechage.length > 0 ? (
        <section aria-label={t('repechage')} className="break-inside-avoid">
          <h3 className="mb-1 font-semibold">{t('repechage')}</h3>
          <p className="mb-3 text-sm text-slate-600">{t('repechageHint')}</p>
          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
            {(['A', 'B'] as const).map((pool) => (
              <div key={pool}>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">{t('pool', { pool })}</h4>
                <ol className="space-y-2">
                  {repechage
                    .filter((n) => n.position === (pool === 'A' ? 1 : 2))
                    .sort((a, b) => a.round - b.round)
                    .map((n) => (
                      <li key={n.key}>
                        <MatchCard node={n} ctx={ctx} />
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RoundRobinView({ view }: { view: BracketViewDto }) {
  const t = useTranslations('bracket');
  const ctx = useCtx(view);
  const order = [...view.participants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const pairNode = (a: string, b: string): BracketNodeDto | undefined =>
    view.nodes.find(
      (n) => (n.red.entryId === a && n.blue.entryId === b) || (n.red.entryId === b && n.blue.entryId === a),
    );
  const rounds = [...new Set(view.nodes.map((n) => n.round))].sort((a, b) => a - b);
  return (
    <div className="space-y-6">
      <section aria-label={t('crossTable')}>
        <h3 className="mb-2 font-semibold">{t('crossTable')}</h3>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-slate-600">
                <th scope="col" className="border border-slate-200 px-2 py-1">
                  №
                </th>
                <th scope="col" className="border border-slate-200 px-2 py-1 text-left">
                  {t('participant')}
                </th>
                {order.map((p, i) => (
                  <th key={p.entryId} scope="col" className="w-14 border border-slate-200 px-2 py-1">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((p, i) => (
                <tr key={p.entryId}>
                  <th scope="row" className="border border-slate-200 px-2 py-1 font-medium">
                    {i + 1}
                  </th>
                  <td className="border border-slate-200 px-2 py-1">
                    <span className="block whitespace-nowrap">{p.publicName}</span>
                    <span className="block whitespace-nowrap text-xs text-slate-500">
                      {p.organization?.name ?? ''}
                    </span>
                  </td>
                  {order.map((q) => {
                    if (q.entryId === p.entryId)
                      return <td key={q.entryId} className="border border-slate-200 bg-slate-200" />;
                    const n = pairNode(p.entryId, q.entryId);
                    const side = n?.red.entryId === p.entryId ? 'RED' : 'BLUE';
                    const decided = n?.status === 'DECIDED';
                    return (
                      <td key={q.entryId} className="border border-slate-200 px-1 py-1 text-center text-xs">
                        {n?.match?.number ? t('match', { number: n.match.number }) : ''}
                        {decided ? (n?.winnerSide === side ? ' ✓' : ' ✗') : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-label={t('roundsList')}>
        <h3 className="mb-2 font-semibold">{t('roundsList')}</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-3">
          {rounds.map((r) => (
            <div key={r} className="break-inside-avoid">
              <h4 className="mb-2 text-sm font-semibold text-slate-700">{t('roundN', { round: r })}</h4>
              <ol className="space-y-2">
                {view.nodes
                  .filter((n) => n.round === r)
                  .sort(byPosition)
                  .map((n) => (
                    <li key={n.key}>
                      <MatchCard node={n} ctx={ctx} />
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function BracketView({ view }: { view: BracketViewDto }) {
  return view.format === 'ROUND_ROBIN' ? <RoundRobinView view={view} /> : <EliminationView view={view} />;
}
