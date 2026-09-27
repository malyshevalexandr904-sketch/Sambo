'use client';
// Страница турнира: обзор и переходы, положение, категории, персонал, заявки и участники, мандатная комиссия
// (допуск, прибытие, взвешивание, медицина). Вкладки и действия —
// по allowedActions турнира: интерфейс лишь скрывает недоступное, решает сервер.
import { type Competition } from '@sde/contracts';
import { Alert, Badge, EmptyState, PageHeader, cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { QueryState } from '@/components/common';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { AdmissionTab } from '@/features/operations/admission-tab';
import { CheckInTab } from '@/features/operations/checkin-tab';
import { MedicalTab } from '@/features/operations/medical-tab';
import { WeighInTab } from '@/features/operations/weighin-tab';
import { ApplicationsTab, EntriesTab } from './registrations-tabs';
import { CategoriesTab } from './categories';
import { OverviewTab } from './overview';
import { RegulationTab } from './regulation';
import { CompetitionStatusBadge, formatDates, useCompetition } from './shared';
import { StaffTab } from './staff';

const TABS = [
  'overview',
  'regulation',
  'categories',
  'staff',
  'applications',
  'entries',
  'admission',
  'checkin',
  'weighin',
  'medical',
] as const;
type Tab = (typeof TABS)[number];

function visibleTabs(c: Competition): Tab[] {
  const can = (a: string): boolean => c.allowedActions.includes(a);
  return TABS.filter((tab) => {
    if (tab === 'staff') return can('competition.view');
    if (tab === 'entries') return can('registration.view');
    if (tab === 'admission') return can('admission.view') && c.status !== 'DRAFT';
    if (tab === 'checkin') return can('checkin.view') && c.status !== 'DRAFT';
    if (tab === 'weighin') return can('weighin.view') && c.status !== 'DRAFT';
    if (tab === 'medical') return can('medical.view') && c.status !== 'DRAFT';
    return true;
  });
}

export function CompetitionPage({ id }: { id: string }) {
  const t = useTranslations('competitions');
  const locale = useLocale();
  const query = useCompetition(id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (query.error instanceof ApiError && query.error.code === 'NOT_FOUND') {
    return (
      <EmptyState title={t('notFound')}>
        <Link href="/competitions" className="font-medium text-blue-700 hover:underline">
          {t('backToList')}
        </Link>
      </EmptyState>
    );
  }
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => {
        const c = query.data as Competition;
        const tabs = visibleTabs(c);
        const requested = params.get('tab') as Tab | null;
        const tab: Tab = requested && tabs.includes(requested) ? requested : 'overview';
        return (
          <>
            <PageHeader
              title={c.name}
              description={
                <>
                  {formatDates(c.startDate, c.endDate, locale)} · {c.organizer.name}
                  {c.venue ? ` · ${c.venue.name}${c.venue.city ? `, ${c.venue.city}` : ''}` : ''}
                </>
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {c.writeAuthority.holder === 'NODE' ? (
                    <Badge tone="warning">{t('leaseAtNode')}</Badge>
                  ) : null}
                  <CompetitionStatusBadge status={c.status} />
                </div>
              }
            />
            {c.status === 'CANCELLED' && c.cancelReason ? (
              <Alert tone="danger" className="mb-4">
                {t('cancelledBecause', { reason: c.cancelReason })}
              </Alert>
            ) : null}
            <nav
              className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200"
              aria-label={t('tabs.label')}
            >
              {tabs.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="tab"
                  aria-selected={tab === x}
                  className={cn(
                    'min-h-11 whitespace-nowrap border-b-2 px-3 text-sm font-medium',
                    tab === x
                      ? 'border-blue-700 text-blue-800'
                      : 'border-transparent text-slate-600 hover:text-slate-900',
                  )}
                  onClick={() => router.replace({ pathname, query: x === 'overview' ? {} : { tab: x } })}
                >
                  {t(`tabs.${x}`)}
                </button>
              ))}
            </nav>
            {tab === 'overview' ? <OverviewTab competition={c} /> : null}
            {tab === 'regulation' ? <RegulationTab competition={c} /> : null}
            {tab === 'categories' ? <CategoriesTab competition={c} /> : null}
            {tab === 'staff' ? <StaffTab competition={c} /> : null}
            {tab === 'applications' ? <ApplicationsTab competition={c} /> : null}
            {tab === 'entries' ? <EntriesTab competition={c} /> : null}
            {tab === 'admission' ? <AdmissionTab competition={c} /> : null}
            {tab === 'checkin' ? <CheckInTab competition={c} /> : null}
            {tab === 'weighin' ? <WeighInTab competition={c} /> : null}
            {tab === 'medical' ? <MedicalTab competition={c} /> : null}
          </>
        );
      }}
    </QueryState>
  );
}
