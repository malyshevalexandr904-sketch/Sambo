'use client';
// Тип турнира на карточке (docs/RATING_ARCHITECTURE.md, 3.1, 9): все видят «Рейтинговый» / «Безрейтинговый» и
// кратко — как считается рейтинг Эло (правки 07.11.2026). Сервер проверяет права сам, кнопка лишь повторяет проверку.
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

/**
 * Рейтинг на карточке турнира. Правки 07.11.2026, п. 12: все турниры платформы рейтинговые — кнопки «Сделать без
 * рейтинга» больше нет, вместо неё кратко о том, как считается рейтинг Эло. Включить рейтинг можно только у старого
 * безрейтингового черновика (до перехода на рейтинговую систему).
 */
export function RatingCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions.rating');
  const queryClient = useQueryClient();
  const admin = c.allowedActions.includes('competition.convert_to_rated');
  const rated = c.competitionType === 'RATED';
  if (!rated && !admin) return null;

  const enable = async (reason: string): Promise<void> => {
    const res = await api<DataEnvelope<Competition>>(`/admin/competitions/${c.id}/rating`, {
      method: 'POST',
      body: { reason },
    });
    queryClient.setQueryData(qk.competition(c.id), res.data);
    await queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
  };

  return (
    <Card>
      <CardTitle>
        {t('title')} <CompetitionTypeBadge competition={c} />
      </CardTitle>
      <div className="space-y-2 text-sm text-slate-700">
        <p>{t('elo.p1')}</p>
        <p>{t('elo.p2')}</p>
        <p>{t('elo.p3')}</p>
      </div>
      {c.rating ? (
        <p className="mt-3 text-xs text-slate-500">
          {t('ruleSet')}: {c.rating.ruleSet.name} · {c.rating.ruleSet.calculationVersion}
        </p>
      ) : null}
      {admin && !rated && !c.publishedAt ? (
        <div className="mt-4">
          <ReasonAction
            variant="primary"
            label={t('enable')}
            title={t('enableTitle')}
            description={t('enableDescription')}
            onConfirm={(reason) => enable(reason)}
          />
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
