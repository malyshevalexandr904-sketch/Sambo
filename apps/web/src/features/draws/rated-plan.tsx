'use client';
// План рейтингового формата категории (docs/RATED_TOURNAMENT_FORMAT.md): подгруппы, выход в финальную часть, число
// схваток — по числу допущенных участников. План считает сервер (общая функция контрактов), веб только показывает.
import type { RatedFormatPlanResult } from '@sde/contracts';
import { Alert, Card, CardTitle } from '@sde/ui';
import { useTranslations } from 'next-intl';

export function RatedPlanCard({ result }: { result: RatedFormatPlanResult }) {
  const t = useTranslations('draws.ratedPlan');
  const letter = (l: string): string => t(`letters.${l}`);
  const ref = (r: string): string => `${letter(r[0] ?? '')}${r.slice(1)}`;
  if (!result.ok)
    return (
      <Alert tone="warning">
        {t(result.issue, { min: result.minParticipants, max: result.maxParticipants })}
      </Alert>
    );
  const p = result.plan;
  return (
    <Card className="print:hidden">
      <CardTitle>{t('title')}</CardTitle>
      <p className="text-sm text-slate-700">
        {p.groups.length === 1
          ? t('roundRobin', { count: p.participants })
          : t('groups', {
              groups: p.groups.length,
              qualifiers: p.qualifiersPerGroup,
              final: p.finalBracketSize,
            })}
      </p>
      {p.groups.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {p.groups.map((g) => (
            <li key={g.letter} className="rounded-md bg-slate-50 px-3 py-1">
              {t('group', { letter: letter(g.letter), size: g.size })}
            </li>
          ))}
        </ul>
      ) : null}
      {p.finalPairing.length > 0 ? (
        <p className="mt-3 text-sm text-slate-700">
          {t('finalPairs', { pairs: p.finalPairing.map(([a, b]) => `${ref(a)} — ${ref(b)}`).join(', ') })}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-slate-700">
        {t('matches', { total: p.totalMatches, groups: p.groupMatches, final: p.finalMatches })}
      </p>
      {p.finalBracketSize > 0 ? <p className="mt-1 text-sm text-slate-600">{t('thirdPlace')}</p> : null}
    </Card>
  );
}
