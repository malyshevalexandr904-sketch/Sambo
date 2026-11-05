'use client';
// «Турниры → Ваши черновики» (правки 05.11.2026): организатор видит свои черновики заявок на проведение и заявки
// на согласовании — до публикации турнира их видят только организация и администратор платформы.
import { type CompetitionRequestDto, type Page, stageOfCompetition } from '@sde/contracts';
import { Card } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { formatDates } from '@/features/competitions/shared';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { RequestStatusBadge } from './shared';

export function MyHostingRequests() {
  const t = useTranslations('competitionRequests');
  const ts = useTranslations('stages');
  const locale = useLocale();
  const list = useQuery({
    queryKey: ['competition-requests', 'mine-open'],
    queryFn: () => api<Page<CompetitionRequestDto>>('/competition-requests', { query: { limit: 50 } }),
  });
  const rows = list.data?.data ?? [];
  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const review = rows.filter(
    (r) => r.status === 'SUBMITTED' || (r.status === 'APPROVED' && r.competition?.status === 'DRAFT'),
  );
  if (drafts.length === 0 && review.length === 0) return null;
  const day = (iso: string) => formatDates(iso.slice(0, 10), iso.slice(0, 10), locale);
  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      {drafts.length > 0 ? (
        <section aria-labelledby="my-drafts">
          <h2 id="my-drafts" className="mb-1 text-lg font-semibold">
            {t('myDrafts')}
          </h2>
          <p className="mb-3 text-sm text-slate-600">{t('myDraftsHint')}</p>
          <ul className="space-y-2">
            {drafts.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-xs text-slate-600">{t('draftUpdated', { date: day(r.updatedAt) })}</p>
                  </div>
                  <Link
                    href={`/competition-requests/new?draft=${r.id}`}
                    className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
                  >
                    {t('continueDraft')}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {review.length > 0 ? (
        <section aria-labelledby="my-review">
          <h2 id="my-review" className="mb-1 text-lg font-semibold">
            {t('myReview')}
          </h2>
          <p className="mb-3 text-sm text-slate-600">{t('myReviewHint')}</p>
          <ul className="space-y-2">
            {review.map((r) => {
              const ready = r.allowedActions.includes('publish');
              return (
                <li key={r.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/competition-requests/${r.id}`} className="font-medium text-blue-800 hover:underline">
                        {r.name}
                      </Link>
                      <p className="text-xs text-slate-600">{formatDates(r.startDate, r.endDate, locale)}</p>
                    </div>
                    {ready ? (
                      <Link
                        href={`/competition-requests/${r.id}`}
                        className="inline-flex min-h-11 items-center rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800"
                      >
                        {t('readyToPublish')}
                      </Link>
                    ) : r.competition ? (
                      <span className="text-sm text-slate-600">
                        {ts(`names.${stageOfCompetition(r.competition.status) ?? 'REVIEW'}`)}
                      </span>
                    ) : (
                      <RequestStatusBadge status={r.status} />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
