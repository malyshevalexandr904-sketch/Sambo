'use client';
// Визуализация сетки (IMPLEMENTATION_PLAN, Phase 5): участники, номера схваток, победители, переходы, BYE,
// утешительные схватки, круговая таблица, подгруппы рейтингового формата. На телефоне — вертикальный список кругов с переключателем
// (ARCHITECTURE.md, 23.3), на экране и в печати — дерево по кругам.
import type { BracketNodeDto, BracketViewDto } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type GroupDecide, GroupStandingTable, StandingRules } from './group-standings';
import { byPosition, MatchCard, useCtx } from './match-card';

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

function EliminationView({
  view,
  matchHref,
  stage = 'MAIN',
}: {
  view: BracketViewDto;
  matchHref?: (id: string) => string;
  /** Этап на выбывание: основная сетка или финальная часть рейтингового формата. */
  stage?: 'MAIN' | 'FINAL';
}) {
  const t = useTranslations('bracket');
  const ctx = useCtx(view, matchHref);
  const main = view.nodes.filter((n) => n.stage === stage);
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

function RoundRobinView({ view, matchHref }: { view: BracketViewDto; matchHref?: (id: string) => string }) {
  const t = useTranslations('bracket');
  const ctx = useCtx(view, matchHref);
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

/** Рейтинговый формат: каждая подгруппа — своя круговая таблица и свои круги, затем финальная часть на выбывание. */
function GroupsView({
  view,
  matchHref,
  decide,
}: {
  view: BracketViewDto;
  matchHref?: (id: string) => string;
  decide?: GroupDecide;
}) {
  const t = useTranslations('bracket');
  const letters = useTranslations('draws.ratedPlan.letters');
  const groups = [...new Set(view.nodes.map((n) => n.group).filter((g) => g !== null))].sort();
  const participants = new Map(view.participants.map((p) => [p.entryId, p]));
  return (
    <div className="space-y-8">
      {view.groups ? <StandingRules groups={view.groups} /> : null}
      {groups.map((group) => (
        <section
          key={group}
          aria-label={t('group', { group: letters(group) })}
          className="break-inside-avoid"
        >
          <h3 className="mb-3 text-lg font-semibold">{t('group', { group: letters(group) })}</h3>
          {view.groups?.standings
            .filter((s) => s.group === group)
            .map((s) => (
              <div key={s.group} className="mb-4">
                <GroupStandingTable
                  standing={s}
                  participants={participants}
                  qualifiers={view.groups?.qualifiersPerGroup ?? 0}
                  decide={view.groups?.canDecide ? decide : undefined}
                />
              </div>
            ))}
          <RoundRobinView
            view={{
              ...view,
              nodes: view.nodes.filter((n) => n.group === group),
              participants: view.participants.filter((p) => p.pool === group),
            }}
            matchHref={matchHref}
          />
        </section>
      ))}
      {view.nodes.some((n) => n.stage === 'FINAL') ? (
        <section aria-label={t('finalPart')} className="break-inside-avoid">
          <h3 className="mb-1 text-lg font-semibold">{t('finalPart')}</h3>
          <p className="mb-3 text-sm text-slate-600">{t('finalPartHint')}</p>
          <EliminationView view={view} matchHref={matchHref} stage="FINAL" />
        </section>
      ) : null}
    </div>
  );
}

export function BracketView({
  view,
  matchHref,
  decide,
}: {
  view: BracketViewDto;
  /** Ссылка на страницу схватки: номер схватки в карточке становится ссылкой. */
  matchHref?: (matchId: string) => string;
  /** Опубликованная сетка рейтингового формата: решение общего места подгруппы (если есть право). */
  decide?: GroupDecide;
}) {
  if (view.format === 'SPECIAL_GROUP_RATED')
    return <GroupsView view={view} matchHref={matchHref} decide={decide} />;
  return view.format === 'ROUND_ROBIN' ? (
    <RoundRobinView view={view} matchHref={matchHref} />
  ) : (
    <EliminationView view={view} matchHref={matchHref} />
  );
}
