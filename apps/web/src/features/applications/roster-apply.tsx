'use client';
// Заявка на турнир списком (правки 09.11.2026, п. 3): тренер нажимает «Подать заявку» — сразу выпадает список его
// спортсменов. Над списком — «Выбрать всех» и «Подходящих по возрасту»; у каждого спортсмена видно, в порядке ли
// документы (зелёный), не загружены (красный) или просрочены (оранжевый). Заявку можно подать и со спортсменами,
// у которых проблемы с документами: если они успеют обновить документы до окончания регистрации — остаются
// в заявке, иначе система исключит их автоматически.
import type {
  ApplicationDto,
  ApplicationSummary,
  Competition,
  DataEnvelope,
  EligibleCategory,
  EntriesBulkResult,
  Page,
  RosterAthlete,
  RosterDto,
} from '@sde/contracts';
import { kgToGrams } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, cn, EmptyState, Input, Select } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { QueryState } from '@/components/common';
import { OrganizationPicker } from '@/components/organization-picker';
import { formatInZone, useWeightLabel } from '@/features/competitions/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { organizationsWith, platformHas } from '@/lib/access';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pickName, useMe } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { DocBadge } from './doc-badge';

const EDITABLE = new Set(['DRAFT', 'WAITING_DOCUMENTS']);

interface Choice {
  categoryId: string;
  weight: string;
}

/** Категория, куда проходит вес: нижняя граница не включается, верхняя — включается. */
function categoryForWeight(list: EligibleCategory[], grams: number | null): string | null {
  if (grams === null) return null;
  const fits = list.filter((c) => {
    const lower = c.weight.lowerGrams;
    const upper = c.weight.kind === 'UP_TO' ? c.weight.upperGrams : null;
    return (lower === null || grams > lower) && (upper === null || grams <= upper);
  });
  return fits[0]?.id ?? null;
}

export function RosterApplyCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('roster');
  const locale = useLocale();
  const params = useSearchParams();
  const { data: me } = useMe();
  const [org, setOrg] = useState('');
  const [open, setOpen] = useState(params.get('apply') === '1');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && params.get('apply') === '1')
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open, params]);
  const available =
    platformHas(me, 'registration.create') || organizationsWith(me, 'registration.create').length > 0;
  if (!available) return null;
  return (
    <div ref={ref} className="xl:col-span-2">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="mb-1">{t('title')}</CardTitle>
            <p className="text-sm text-slate-600">
              {t('hint', { until: formatInZone(c.registrationEndsAt, c.timezone, locale) })}
            </p>
          </div>
          {!open ? (
            <Button size="lg" onClick={() => setOpen(true)}>
              {t('open')}
            </Button>
          ) : null}
        </div>
        {open ? (
          <div className="mt-4 space-y-4">
            <OrganizationPicker
              id="roster-org"
              label={t('organization')}
              permission="registration.create"
              value={org}
              onChange={setOrg}
              className="max-w-md"
            />
            {org ? <RosterList competition={c} organizationId={org} /> : null}
          </div>
        ) : null}
        <p className="mt-3 text-sm">
          <Link
            href={{ pathname: '/applications', query: { competitionId: c.id } }}
            className="text-blue-700 hover:underline"
          >
            {t('myApplications')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

function RosterList({
  competition: c,
  organizationId,
}: {
  competition: Competition;
  organizationId: string;
}) {
  const t = useTranslations('roster');
  const locale = useLocale();
  const router = useRouter();
  const weightLabel = useWeightLabel();
  const action = useAction();
  const roster = useQuery({
    queryKey: ['competitions', c.id, 'roster', organizationId],
    queryFn: async () =>
      (
        await api<DataEnvelope<RosterDto>>(`/competitions/${c.id}/roster`, {
          query: { organizationId },
        })
      ).data,
  });
  const [selected, setSelected] = useState<Record<string, Choice>>({});
  const [report, setReport] = useState<EntriesBulkResult | null>(null);
  const athletes = roster.data?.athletes ?? [];
  const free = athletes.filter((a) => !a.entered);
  // «Выбрать по возрастной категории»: например, 12–14 лет — возраст на дату начала турнира.
  const [ageFrom, setAgeFrom] = useState('');
  const [ageTo, setAgeTo] = useState('');
  const lo = Number.parseInt(ageFrom, 10);
  const hi = Number.parseInt(ageTo, 10);
  const byAge =
    Number.isNaN(lo) && Number.isNaN(hi)
      ? []
      : free.filter((a) => (Number.isNaN(lo) || a.age >= lo) && (Number.isNaN(hi) || a.age <= hi));
  const choose = (a: RosterAthlete): Choice => ({
    categoryId:
      selected[a.athleteId]?.categoryId ?? (a.eligible.length === 1 ? (a.eligible[0]?.id ?? '') : ''),
    weight: selected[a.athleteId]?.weight ?? '',
  });
  const toggle = (a: RosterAthlete, on: boolean): void =>
    setSelected((s) => {
      const next = { ...s };
      if (on) next[a.athleteId] = choose(a);
      else delete next[a.athleteId];
      return next;
    });
  const selectMany = (list: RosterAthlete[]): void =>
    setSelected(Object.fromEntries(list.map((a) => [a.athleteId, choose(a)])));
  const update = (id: string, patch: Partial<Choice>): void =>
    setSelected((s) => ({ ...s, [id]: { ...(s[id] ?? { categoryId: '', weight: '' }), ...patch } }));
  const chosen = athletes.filter((a) => selected[a.athleteId]);
  const withoutCategory = chosen.filter((a) => !selected[a.athleteId]?.categoryId);
  const problems = chosen.filter((a) => a.documents.state === 'MISSING' || a.documents.state === 'EXPIRED');
  const ready = chosen.length > 0 && withoutCategory.length === 0;

  const submit = (): Promise<unknown> =>
    action.run(async () => {
      setReport(null);
      // Черновик или возвращённая на исправление заявка клуба — дополняем её; иначе — новая заявка.
      const mine = await api<Page<ApplicationSummary>>('/me/applications', {
        query: { competitionId: c.id, limit: 50 },
      });
      const editable = mine.data.find((x) => x.organization.id === organizationId && EDITABLE.has(x.status));
      const applicationId =
        editable?.id ??
        (
          await api<DataEnvelope<ApplicationDto>>(`/competitions/${c.id}/applications`, {
            method: 'POST',
            body: { organizationId },
          })
        ).data.id;
      const result = await api<DataEnvelope<EntriesBulkResult>>(
        `/applications/${applicationId}/entries/bulk`,
        {
          method: 'POST',
          body: {
            items: chosen.map((a) => {
              const choice = selected[a.athleteId] as Choice;
              const grams = kgToGrams(choice.weight);
              return {
                athleteId: a.athleteId,
                categoryId: choice.categoryId,
                ...(grams !== null && grams >= 10_000 && grams <= 250_000
                  ? { declaredWeightGrams: grams }
                  : {}),
              };
            }),
          },
        },
      );
      setReport(result.data);
      if (result.data.added === 0) return;
      const app = await api<DataEnvelope<ApplicationDto>>(`/applications/${applicationId}`);
      if (EDITABLE.has(app.data.status))
        await api(`/applications/${applicationId}/transitions`, {
          method: 'POST',
          body: { to: 'SUBMITTED' },
          version: app.data.version,
        });
      router.push(`/applications/${applicationId}`);
    });

  return (
    <QueryState isPending={roster.isPending} error={roster.error}>
      {() =>
        athletes.length === 0 ? (
          <EmptyState title={t('empty')}>
            <Link href="/athletes/new" className="font-medium text-blue-700 hover:underline">
              {t('addAthlete')}
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
              <Button size="sm" onClick={() => selectMany(free)} disabled={free.length === 0}>
                {t('selectAll', { count: free.length })}
              </Button>
              <span className="flex flex-wrap items-center gap-1 text-sm">
                <label htmlFor="ra-age-from">{t('ageFrom')}</label>
                <Input
                  id="ra-age-from"
                  inputMode="numeric"
                  className="w-16"
                  value={ageFrom}
                  onChange={(e) => setAgeFrom(e.target.value)}
                />
                <label htmlFor="ra-age-to">{t('ageTo')}</label>
                <Input
                  id="ra-age-to"
                  inputMode="numeric"
                  className="w-16"
                  value={ageTo}
                  onChange={(e) => setAgeTo(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => selectMany(byAge)}
                  disabled={byAge.length === 0}
                >
                  {t('selectByAge', { count: byAge.length })}
                </Button>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected({})}
                disabled={chosen.length === 0}
              >
                {t('clear')}
              </Button>
              <span className="ml-auto text-sm text-slate-700" role="status">
                {t('selected', { count: chosen.length })}
              </span>
            </div>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {athletes.map((a) => {
                const on = !!selected[a.athleteId];
                const choice = selected[a.athleteId];
                const name = [a.lastName, a.firstName, a.middleName].filter(Boolean).join(' ');
                return (
                  <li
                    key={a.athleteId}
                    className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 p-3', on && 'bg-blue-50/60')}
                  >
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        checked={on}
                        disabled={!!a.entered}
                        onChange={(e) => toggle(a, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{name}</span>
                        <span className="block text-xs text-slate-600">
                          {formatDate(a.birthDate, locale)} · {t('age', { age: a.age })}
                          {a.rankCode ? ` · ${a.rankCode}` : ''}
                        </span>
                      </span>
                    </label>
                    <DocBadge documents={a.documents} detailed />
                    {a.entered ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {t('alreadyEntered')}
                      </span>
                    ) : a.eligible.length === 0 ? (
                      <span className="text-xs text-slate-600">{t('noCategory')}</span>
                    ) : on && choice ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={t('weight')}
                          placeholder={t('weight')}
                          inputMode="decimal"
                          className="w-24"
                          value={choice.weight}
                          onChange={(e) => {
                            const auto = categoryForWeight(a.eligible, kgToGrams(e.target.value));
                            update(a.athleteId, {
                              weight: e.target.value,
                              ...(auto ? { categoryId: auto } : {}),
                            });
                          }}
                        />
                        <Select
                          aria-label={t('category')}
                          className="w-56"
                          value={choice.categoryId}
                          onChange={(e) => update(a.athleteId, { categoryId: e.target.value })}
                        >
                          <option value="">{t('chooseCategory')}</option>
                          {a.eligible.map((x) => (
                            <option key={x.id} value={x.id}>
                              {pickName(x.name, locale)} · {weightLabel(x.weight)}
                            </option>
                          ))}
                        </Select>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {problems.length > 0 ? (
              <Alert tone="warning">
                {t('problemsHint', {
                  count: problems.length,
                  until: formatInZone(c.registrationEndsAt, c.timezone, locale),
                })}
              </Alert>
            ) : null}
            {withoutCategory.length > 0 ? (
              <p className="text-sm text-red-700">{t('needCategory', { count: withoutCategory.length })}</p>
            ) : null}
            {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
            {report && report.failed.length > 0 ? (
              <Alert tone="warning">
                {t('failed', { added: report.added, failed: report.failed.length })}
              </Alert>
            ) : null}
            <Button size="lg" loading={action.busy} disabled={!ready} onClick={() => void submit()}>
              {t('submit', { count: chosen.length })}
            </Button>
          </div>
        )
      }
    </QueryState>
  );
}
