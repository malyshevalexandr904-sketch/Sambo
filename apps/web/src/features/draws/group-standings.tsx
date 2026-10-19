'use client';
// Таблица подгруппы рейтингового формата (ТЗ 31): места и критерии считает сервер, здесь — только показ.
import type { BracketViewDto, DrawParticipantDto, GroupStandingsDto } from '@sde/contracts';
import { Alert, Badge } from '@sde/ui';
import { useTranslations } from 'next-intl';

type Groups = NonNullable<BracketViewDto['groups']>;

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

export function GroupStandingTable({
  standing,
  participants,
  qualifiers,
}: {
  standing: GroupStandingsDto;
  participants: Map<string, DrawParticipantDto>;
  qualifiers: number;
}) {
  const t = useTranslations('bracket.standings');
  const head = 'border border-slate-200 px-2 py-1';
  return (
    <div className="space-y-2">
      {standing.decisionRequired ? <Alert tone="warning">{t('decisionRequired')}</Alert> : null}
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
