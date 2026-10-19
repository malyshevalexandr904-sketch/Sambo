'use client';
// Тип турнира на карточке (docs/RATING_ARCHITECTURE.md, 3.1, 9): все видят «Рейтинговый» / «Безрейтинговый»;
// включить рейтинг или сменить тип может только администратор платформы — сервер проверяет право сам, кнопки
// лишь повторяют проверку.
import type { Competition, DataEnvelope, RatingRuleSetSummary } from '@sde/contracts';
import { Badge, Card, CardTitle } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

export function CompetitionTypeBadge({
  competition: c,
}: {
  competition: Pick<Competition, 'competitionType'>;
}) {
  const t = useTranslations('competitions.rating');
  return (
    <Badge tone={c.competitionType === 'RATED' ? 'info' : 'neutral'}>{t(`types.${c.competitionType}`)}</Badge>
  );
}

export function RatingCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions.rating');
  const queryClient = useQueryClient();
  const admin = c.allowedActions.includes('competition.convert_to_rated');
  const rated = c.competitionType === 'RATED';
  if (!rated && !admin) return null;

  const run = async (path: string, body: Record<string, unknown>): Promise<void> => {
    const res = await api<DataEnvelope<Competition>>(`/admin/competitions/${c.id}/${path}`, {
      method: 'POST',
      body,
    });
    queryClient.setQueryData(qk.competition(c.id), res.data);
    await queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  };

  return (
    <Card>
      <CardTitle>
        {t('title')} <CompetitionTypeBadge competition={c} />
      </CardTitle>
      {c.rating ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-600">{t('ruleSet')}</dt>
          <dd>
            {c.rating.ruleSet.name} · {c.rating.ruleSet.calculationVersion}
          </dd>
          <dt className="text-slate-600">{t('publicDeltas')}</dt>
          <dd>{c.rating.publicDeltas ? t('yes') : t('no')}</dd>
        </dl>
      ) : null}
      <p className="mt-3 text-sm text-slate-600">{rated ? t('ratedHint') : t('nonRatedHint')}</p>
      {admin ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!rated && !c.publishedAt ? (
            <ReasonAction
              variant="primary"
              label={t('enable')}
              title={t('enableTitle')}
              description={t('enableDescription')}
              onConfirm={(reason) => run('rating', { reason })}
            />
          ) : (
            <ReasonAction
              variant={rated ? 'danger' : 'secondary'}
              label={rated ? t('makeNonRated') : t('makeRated')}
              title={t('changeTitle')}
              description={t('changeDescription')}
              onConfirm={(reason) =>
                run('rating-type-change', { competitionType: rated ? 'NON_RATED' : 'RATED', reason })
              }
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}

/** Действующая версия правил расчёта — показывается при создании рейтингового турнира (только чтение). */
export function ActiveRatingRules({ enabled }: { enabled: boolean }) {
  const t = useTranslations('competitions.rating');
  const q = useQuery({
    queryKey: ['admin', 'rating', 'rule-set'],
    enabled,
    queryFn: async () =>
      (await api<DataEnvelope<RatingRuleSetSummary>>('/admin/rating/rule-sets/active')).data,
  });
  if (!enabled) return null;
  if (!q.data) return <p className="text-sm text-slate-600">{q.isError ? t('rulesUnavailable') : '…'}</p>;
  const r = q.data;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-slate-600">{t('ruleSet')}</dt>
      <dd>
        {r.name} · {r.calculationVersion}
      </dd>
      <dt className="text-slate-600">{t('initialRating')}</dt>
      <dd>{r.rules.initialRating}</dd>
      <dt className="text-slate-600">{t('kFactors')}</dt>
      <dd>
        {r.rules.kFactorRules
          .map((k, i, all) =>
            k.maxRating === null
              ? t('kAbove', { k: k.k, from: all[i - 1]?.maxRating ?? 0 })
              : t('kUpTo', { k: k.k, to: k.maxRating }),
          )
          .join('; ')}
      </dd>
      <dt className="text-slate-600">{t('levels')}</dt>
      <dd>{t('levelsRange', { count: r.rules.levelRules.length })}</dd>
      <dt className="text-slate-600">{t('format')}</dt>
      <dd>{t('formatHint')}</dd>
    </dl>
  );
}
