'use client';
// Страница турнира: обзор и переходы, положение, категории, персонал, заявки и участники, мандатная комиссия
// (допуск, прибытие, взвешивание, медицина), жеребьёвка, расписание, бригады, итоги. Вкладки и действия —
// по allowedActions турнира: интерфейс лишь скрывает недоступное, решает сервер.
import type { Competition } from '@sde/contracts';
import { Alert, Badge, EmptyState, PageHeader, cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useCompetitionLive } from '@/lib/live';
import { AdmissionTab } from '@/features/operations/admission-tab';
import { CheckInTab } from '@/features/operations/checkin-tab';
import { MedicalTab } from '@/features/operations/medical-tab';
import { WeighInTab } from '@/features/operations/weighin-tab';
import { DrawsTab } from '@/features/draws/draws-tab';
import { CrewsTab } from '@/features/scheduling/crews-tab';
import { ResultsTab } from '@/features/results/results-tab';
import { ScheduleTab } from '@/features/scheduling/schedule-tab';
import { OtherRolesHint } from '@/features/cabinet-role';
import { ApplicationsTab, EntriesTab } from './registrations-tabs';
import { CategoriesTab } from './categories';
import { OverviewTab } from './overview';
import { RegulationTab } from './regulation';
import { CompetitionStatusBadge, formatDates, useCompetition } from './shared';
import { StaffTab } from './staff';
import { BracketsTab } from '@/features/draws/brackets-tab';
import { QuickWeighInCard } from '@/features/operations/quick-weighin';
import { CommissionTab } from './commission';
import { GeneralTab } from './general-tab';
import { MatsStaffCard } from './mats-staff';

const TABS = [
  'general',
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
  'draws',
  'schedule',
  'crews',
  'results',
  'brackets',
] as const;
type Tab = (typeof TABS)[number];

/** Вкладки администратора и организатора (правки 09.11.2026, п. 3): весь турнир — в пяти вкладках. */
const STAFF_MAIN: readonly Tab[] = ['general', 'applications', 'staff', 'weighin', 'brackets'];

/** До мандатной комиссии жеребьёвки нет — вкладка не нужна. */
const BEFORE_DRAW: readonly string[] = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
/** До регистрации нет участников — мандатной комиссии, прибытия, взвешивания и медицины тоже. */
const BEFORE_REGISTRATION: readonly string[] = ['DRAFT', 'PUBLISHED'];

function visibleTabs(c: Competition): Tab[] {
  const can = (a: string): boolean => c.allowedActions.includes(a);
  return TABS.filter((tab) => {
    if (tab === 'general' || tab === 'brackets') return c.viewer.staff;
    if (tab === 'overview' || tab === 'regulation') return !c.viewer.staff;
    if (tab === 'staff') return can('competition.view');
    if (tab === 'entries') return can('registration.view');
    if (tab === 'admission') return can('admission.view') && !BEFORE_REGISTRATION.includes(c.status);
    if (tab === 'checkin') return can('checkin.view') && !BEFORE_REGISTRATION.includes(c.status);
    if (tab === 'weighin')
      return can('weighin.view') && (c.viewer.staff || !BEFORE_REGISTRATION.includes(c.status));
    if (tab === 'medical') return can('medical.view') && !BEFORE_REGISTRATION.includes(c.status);
    if (tab === 'draws') return can('competition.view') && !BEFORE_DRAW.includes(c.status);
    if (tab === 'schedule') return can('competition.view') && !BEFORE_DRAW.includes(c.status);
    if (tab === 'crews') return can('competition.view') && !BEFORE_DRAW.includes(c.status);
    if (tab === 'results') return can('competition.view') && !BEFORE_DRAW.includes(c.status);
    return true;
  });
}

export function CompetitionPage({ id }: { id: string }) {
  const t = useTranslations('competitions');
  const locale = useLocale();
  const query = useCompetition(id);
  // Персонал турнира: вкладки (итоги, сетки, расписание, допуск, прибытие, взвешивание) обновляются сами (Phase 8a).
  useCompetitionLive(query.data?.allowedActions.includes('competition.view') ? id : null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [allTabs, setAllTabs] = useState(false);
  if (query.error instanceof ApiError && query.error.code === 'NOT_FOUND') {
    return (
      <EmptyState title={t('notFound')}>
        <Link href="/competitions" className="font-medium text-blue-700 hover:underline">
          {t('backToList')}
        </Link>
        <OtherRolesHint error={query.error} />
      </EmptyState>
    );
  }
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => {
        const c = query.data as Competition;
        const tabs = visibleTabs(c);
        // «Набор судей» перенесён в «Персонал» (правки 07.11.2026, п. 16): старые ссылки ведут туда.
        const rawTab = params.get('tab');
        const requested = (rawTab === 'recruitment' ? 'staff' : rawTab) as Tab | null;
        // Персонал турнира (правки 09.11.2026): пять основных вкладок, остальные разделы — по кнопке «Ещё».
        const staff = c.viewer.staff;
        const home: Tab = staff ? 'general' : 'overview';
        const mapped =
          staff && (requested === 'overview' || requested === 'regulation') ? 'general' : requested;
        const tab: Tab = mapped && tabs.includes(mapped) ? mapped : home;
        const main = staff ? tabs.filter((x) => STAFF_MAIN.includes(x)) : tabs;
        const extra = staff ? tabs.filter((x) => !STAFF_MAIN.includes(x)) : [];
        const showExtra = allTabs || extra.includes(tab);
        const shown: Tab[] = showExtra ? [...main, ...extra] : main;
        return (
          <>
            <div className="print:hidden">
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
                {shown.map((x) => (
                  <button
                    key={x}
                    type="button"
                    role="tab"
                    aria-selected={tab === x}
                    className={cn(
                      'flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium',
                      tab === x
                        ? 'border-blue-700 text-blue-800'
                        : 'border-transparent text-slate-600 hover:text-slate-900',
                      STAFF_MAIN.includes(x) || !staff ? '' : 'text-xs font-normal',
                    )}
                    onClick={() => router.replace({ pathname, query: x === home ? {} : { tab: x } })}
                  >
                    {t(`tabs.${x}`)}
                  </button>
                ))}
                {extra.length > 0 && !extra.includes(tab) ? (
                  <button
                    type="button"
                    className="min-h-11 whitespace-nowrap px-3 text-sm text-blue-700 hover:underline"
                    aria-expanded={showExtra}
                    onClick={() => setAllTabs(!allTabs)}
                  >
                    {showExtra ? t('tabs.less') : t('tabs.more', { count: extra.length })}
                  </button>
                ) : null}
              </nav>
            </div>
            {tab === 'general' ? <GeneralTab competition={c} /> : null}
            {tab === 'brackets' ? <BracketsTab competition={c} /> : null}
            {tab === 'overview' ? <OverviewTab competition={c} /> : null}
            {tab === 'regulation' ? <RegulationTab competition={c} /> : null}
            {tab === 'categories' ? <CategoriesTab competition={c} /> : null}
            {tab === 'staff' ? (
              <div className="space-y-6">
                {staff ? <MatsStaffCard competition={c} /> : null}
                <StaffTab competition={c} />
              </div>
            ) : null}
            {tab === 'applications' ? (
              staff ? (
                <CommissionTab competition={c} />
              ) : (
                <ApplicationsTab competition={c} />
              )
            ) : null}
            {tab === 'entries' ? <EntriesTab competition={c} /> : null}
            {tab === 'admission' ? <AdmissionTab competition={c} /> : null}
            {tab === 'checkin' ? <CheckInTab competition={c} /> : null}
            {tab === 'weighin' ? (
              staff ? (
                <div className="space-y-6">
                  <QuickWeighInCard competition={c} />
                  {BEFORE_REGISTRATION.includes(c.status) ? null : (
                    <details className="rounded-lg border border-slate-200 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-blue-700">
                        {t('tabs.advancedWeighIn')}
                      </summary>
                      <div className="mt-4">
                        <WeighInTab competition={c} />
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <WeighInTab competition={c} />
              )
            ) : null}
            {tab === 'medical' ? <MedicalTab competition={c} /> : null}
            {tab === 'draws' ? <DrawsTab competition={c} /> : null}
            {tab === 'schedule' ? <ScheduleTab competition={c} /> : null}
            {tab === 'crews' ? <CrewsTab competition={c} /> : null}
            {tab === 'results' ? <ResultsTab competition={c} /> : null}
          </>
        );
      }}
    </QueryState>
  );
}
