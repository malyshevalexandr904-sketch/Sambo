'use client';
// Таблица подгруппы рейтингового формата (ТЗ 31): места и критерии считает сервер, здесь — показ и решение главного
// судьи об общем месте, которое критерии не разделили (порядок участников яруса и причина).
import type { BracketViewDto, DrawParticipantDto, GroupStandingsDto } from '@sde/contracts';
import { Alert, Badge, Button } from '@sde/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { api } from '@/lib/api';

type Groups = NonNullable<BracketViewDto['groups']>;

/** Решение общего места в опубликованной сетке: жеребьёвка и обновление экрана после решения. */
export interface GroupDecide {
  drawId: string;
  onDecided: () => Promise<void>;
}

/** Пояснение к таблицам: критерии мест по порядку и пометка, если они ещё не подтверждены. */
export function StandingRules({ groups }: { groups: Groups }) {
  const t = useTranslations('bracket.standings');
  const criteria = groups.criteria.map((c) => t(`criteria.${c}`)).join(' → ');
  return (
    <p className="text-sm text-slate-600">
      {t('rules', { criteria })}
      {groups.criteriaConfirmed ? null : <> {t('provisional')}</>}
    </p>
  );
}

/** Ярусы общего места среди выходящих (на границе или внутри): их порядок решают люди. */
function undecidedTiers(standing: GroupStandingsDto, qualifiers: number): string[][] {
  const byPosition = new Map<number, string[]>();
  for (const r of standing.rows)
    byPosition.set(r.position, [...(byPosition.get(r.position) ?? []), r.entryId]);
  return [...byPosition.entries()]
    .filter(([position, ids]) => ids.length > 1 && position <= qualifiers)
    .map(([, ids]) => ids);
}

/** Решение главного судьи: порядок участников каждого яруса (кнопками «выше/ниже») и причина. */
function DecisionForm({
  drawId,
  standing,
  participants,
  qualifiers,
  onDecided,
}: {
  drawId: string;
  standing: GroupStandingsDto;
  participants: Map<string, DrawParticipantDto>;
  qualifiers: number;
  onDecided: () => Promise<void>;
}) {
  const t = useTranslations('bracket.standings.decision');
  const [tiers, setTiers] = useState(() => undecidedTiers(standing, qualifiers));
  const move = (tier: number, index: number, by: -1 | 1): void =>
    setTiers((all) =>
      all.map((ids, i) => {
        if (i !== tier) return ids;
        const next = [...ids];
        [next[index], next[index + by]] = [next[index + by] as string, next[index] as string];
        return next;
      }),
    );
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm">{t('hint')}</p>
      {tiers.map((ids, tier) => (
        <ol key={ids.join()} className="space-y-1" aria-label={t('tier')}>
          {ids.map((id, i) => (
            <li key={id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-6 text-right tabular-nums">{i + 1}.</span>
              <span className="min-w-40 font-medium">{participants.get(id)?.publicName ?? '—'}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={i === 0}
                onClick={() => move(tier, i, -1)}
                aria-label={t('up', { name: participants.get(id)?.publicName ?? '' })}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={i === ids.length - 1}
                onClick={() => move(tier, i, 1)}
                aria-label={t('down', { name: participants.get(id)?.publicName ?? '' })}
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      ))}
      <ReasonAction
        label={t('action')}
        title={t('title')}
        description={t('description')}
        variant="primary"
        onConfirm={async (reason) => {
          await api(`/draws/${drawId}/group-decisions`, {
            method: 'POST',
            body: { group: standing.group, tiers, reason },
          });
          await onDecided();
        }}
      />
    </div>
  );
}

export function GroupStandingTable({
  standing,
  participants,
  qualifiers,
  decide,
}: {
  standing: GroupStandingsDto;
  participants: Map<string, DrawParticipantDto>;
  qualifiers: number;
  /** Нет права решать общее место — не передаётся. */
  decide?: GroupDecide;
}) {
  const t = useTranslations('bracket.standings');
  const format = useFormatter();
  const head = 'border border-slate-200 px-2 py-1';
  const d = standing.decision;
  return (
    <div className="space-y-2">
      {standing.decisionRequired ? <Alert tone="warning">{t('decisionRequired')}</Alert> : null}
      {standing.decisionRequired && decide ? (
        <DecisionForm
          drawId={decide.drawId}
          standing={standing}
          participants={participants}
          qualifiers={qualifiers}
          onDecided={decide.onDecided}
        />
      ) : null}
      {d ? (
        <p className="text-sm text-slate-600">
          {t('decision.applied', {
            who: d.decidedBy?.displayName ?? '—',
            when: format.dateTime(new Date(d.decidedAt), { dateStyle: 'short', timeStyle: 'short' }),
            reason: d.reason,
          })}
        </p>
      ) : null}
      <div className="overflow-x-auto print:overflow-visible">
        <table className="min-w-full border-collapse text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead>
            <tr className="text-xs text-slate-600">
              <th scope="col" className={head}>
                {t('position')}
              </th>
              <th scope="col" className={`${head} text-left`}>
                {t('participant')}
              </th>
              <th scope="col" className={head}>
                {t('matches')}
              </th>
              <th scope="col" className={head}>
                {t('wins')}
              </th>
              <th scope="col" className={head}>
                {t('losses')}
              </th>
              <th scope="col" className={head}>
                {t('cleanWins')}
              </th>
              <th scope="col" className={head}>
                {t('superiorityWins')}
              </th>
              <th scope="col" className={head}>
                {t('points')}
              </th>
              {qualifiers > 0 ? (
                <th scope="col" className={head}>
                  {t('qualified')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {standing.rows.map((r) => {
              const p = participants.get(r.entryId);
              return (
                <tr key={r.entryId}>
                  <th scope="row" className={`${head} font-medium`}>
                    {r.position}
                  </th>
                  <td className={head}>
                    <span className="block whitespace-nowrap">{p?.publicName ?? '—'}</span>
                    <span className="block whitespace-nowrap text-xs text-slate-500">
                      {p?.organization?.name ?? ''}
                    </span>
                  </td>
                  <td className={`${head} text-center tabular-nums`}>{r.matches}</td>
                  <td className={`${head} text-center tabular-nums font-semibold`}>{r.wins}</td>
                  <td className={`${head} text-center tabular-nums`}>{r.losses}</td>
                  <td className={`${head} text-center tabular-nums`}>{r.tiebreakers.cleanWins}</td>
                  <td className={`${head} text-center tabular-nums`}>{r.tiebreakers.superiorityWins}</td>
                  <td className={`${head} text-center tabular-nums`}>{r.points}</td>
                  {qualifiers > 0 ? (
                    <td className={`${head} text-center`}>
                      {r.qualified === true ? (
                        <Badge tone="success">{t('yes')}</Badge>
                      ) : r.qualified === false ? (
                        <span className="text-slate-500">{t('no')}</span>
                      ) : standing.complete ? (
                        <Badge tone="warning">{t('undecided')}</Badge>
                      ) : (
                        <span className="text-slate-400">…</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
