'use client';
// Обзор турнира: сроки во времени турнира, счётчики (дашборд организатора, первая версия), готовность к
// публикации, переходы статуса, изменение основных данных и подача заявки клубом.
import {
  type ApplicationDto,
  type Competition,
  type DataEnvelope,
  localDateTimeIn,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { OrganizationPicker } from '@/components/organization-picker';
import { Link, useRouter } from '@/i18n/navigation';
import { organizationsWith, platformHas } from '@/lib/access';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk, useMe } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { EditCard } from './edit-card';
import { formatDates, formatInZone, useFailedText } from './shared';

export function OverviewTab({ competition: c }: { competition: Competition }) {
  const can = (a: string): boolean => c.allowedActions.includes(a);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <InfoCard competition={c} />
      {c.status === 'DRAFT' && can('competition.update') ? <ReadinessCard competition={c} /> : null}
      {c.allowedActions.some((a) => a.startsWith('transition:')) ? <TransitionsCard competition={c} /> : null}
      {c.registrationOpenNow ? <ApplyCard competition={c} /> : null}
      {can('competition.update') ? <EditCard competition={c} /> : null}
    </div>
  );
}

function InfoCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions');
  const locale = useLocale();
  const rows: [string, string][] = [
    [t('dates'), formatDates(c.startDate, c.endDate, locale)],
    [
      t('registrationWindow'),
      `${formatInZone(c.registrationStartsAt, c.timezone, locale)} — ${formatInZone(c.registrationEndsAt, c.timezone, locale)}`,
    ],
    [t('level'), t(`levels.${c.level}`)],
    [
      t('ruleSet'),
      c.ruleSetVersion ? `${c.ruleSetVersion.ruleSetName} · v${c.ruleSetVersion.version}` : t('ruleSetNone'),
    ],
  ];
  return (
    <Card>
      <CardTitle>{t('infoTitle')}</CardTitle>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-600">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c.viewer.staff ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['categories', 'applications', 'entriesApproved', 'entriesPending'] as const).map((k) => (
            <div key={k} className="rounded-md bg-slate-50 p-3">
              <dt className="text-xs text-slate-600">{t(`counters.${k}`)}</dt>
              <dd className="text-2xl font-semibold">{c.counters[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {c.status !== 'DRAFT' ? (
        <p className="mt-4 text-sm">
          <Link href={`/tournaments/${c.slug}`} className="font-medium text-blue-700 hover:underline">
            {t('publicPage')}
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

function ReadinessCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions.readiness');
  const items: { ok: boolean; label: string; required: boolean }[] = [
    { ok: !!c.ruleSetVersion, label: t('ruleSet'), required: true },
    { ok: c.counters.categories > 0, label: t('categories'), required: true },
    { ok: Date.parse(c.registrationEndsAt) > Date.now(), label: t('deadline'), required: true },
    { ok: !!c.regulation, label: t('regulation'), required: false },
    { ok: !!c.venue, label: t('venue'), required: false },
  ];
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={i.ok ? 'text-green-700' : i.required ? 'text-red-700' : 'text-slate-400'}
            >
              {i.ok ? '✓' : i.required ? '✗' : '○'}
            </span>
            <span>
              {i.label}
              {!i.required ? <span className="text-slate-500"> — {t('optional')}</span> : null}
              <span className="sr-only">{i.ok ? t('done') : t('notDone')}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Переходы с обязательной причиной: откаты и отмена (ARCHITECTURE.md, 16.1). */
const REASON_REQUIRED = new Set(['CANCELLED']);

function TransitionsCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions');
  const errorMessage = useErrorMessage();
  const failedText = useFailedText();
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<{ to: string; codes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extendTo, setExtendTo] = useState(localDateTimeIn(c.registrationEndsAt, c.timezone));
  const targets = c.allowedActions
    .filter((a) => a.startsWith('transition:'))
    .map((a) => a.slice('transition:'.length));

  const go = async (to: string, extra: Record<string, unknown> = {}): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DataEnvelope<Competition>>(`/competitions/${c.id}/transitions`, {
        method: 'POST',
        body: { to, ...extra },
        version: c.version,
      });
      queryClient.setQueryData(qk.competition(c.id), res.data);
      await queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
      setWarnings(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TRANSITION_PRECONDITIONS_NOT_MET') {
        const d = e.details as { failed?: string[]; warnings?: string[]; confirmable?: boolean } | undefined;
        if (d?.confirmable && d.warnings?.length) {
          setWarnings({ to, codes: d.warnings });
          return;
        }
        setError(`${errorMessage(e)} ${failedText(d?.failed ?? [])}`);
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t('transitionsTitle')}</CardTitle>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {warnings ? (
        <Alert tone="warning" className="mb-3">
          <p>{t('confirmWarnings', { warnings: failedText(warnings.codes) })}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void go(warnings.to, { confirm: true })}>
              {t('confirmAndContinue')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWarnings(null)}>
              {t('cancel')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => {
          const label = t(
            `transitionTo.${c.status === 'REGISTRATION_CLOSED' && to === 'REGISTRATION_OPEN' ? 'REOPEN' : to}`,
          );
          if (c.status === 'REGISTRATION_CLOSED' && to === 'REGISTRATION_OPEN')
            return (
              <div key={to} className="w-full space-y-2 rounded-md border border-slate-200 p-3">
                <Field id="extend-to" label={t('newDeadline')} hint={t('inTimezone', { tz: c.timezone })}>
                  <Input
                    id="extend-to"
                    type="datetime-local"
                    value={extendTo}
                    onChange={(e) => setExtendTo(e.target.value)}
                  />
                </Field>
                <ReasonAction
                  label={label}
                  title={t('reopenTitle')}
                  onConfirm={(reason) =>
                    go(to, { reason, registrationEndsAt: zonedToInstant(extendTo, c.timezone) })
                  }
                />
              </div>
            );
          if (REASON_REQUIRED.has(to) || (c.status === 'DRAWING' && to === 'CHECK_IN'))
            return (
              <ReasonAction
                key={to}
                label={label}
                title={t(`transitionTitle.${to}`)}
                variant={to === 'CANCELLED' ? 'danger' : 'secondary'}
                onConfirm={(reason) => go(to, { reason })}
              />
            );
          return (
            <Button
              key={to}
              variant={to === 'REGISTRATION_OPEN' ? 'primary' : 'secondary'}
              loading={busy}
              onClick={() => void go(to)}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

function ApplyCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('competitions');
  const router = useRouter();
  const { data: me } = useMe();
  const [org, setOrg] = useState('');
  const action = useAction();
  const available =
    platformHas(me, 'registration.create') || organizationsWith(me, 'registration.create').length > 0;
  if (!available) return null;
  const selected = org;
  return (
    <Card>
      <CardTitle>{t('applyTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('applyHint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <OrganizationPicker
          id="apply-org"
          label={t('applyOrganization')}
          permission="registration.create"
          value={selected}
          onChange={setOrg}
          className="min-w-64 flex-1"
        />
        <Button
          loading={action.busy}
          disabled={!selected}
          onClick={() =>
            void action.run(async () => {
              const res = await api<DataEnvelope<ApplicationDto>>(`/competitions/${c.id}/applications`, {
                method: 'POST',
                body: { organizationId: selected },
              });
              router.push(`/applications/${res.data.id}`);
            })
          }
        >
          {t('applyCreate')}
        </Button>
      </div>
      <p className="mt-3 text-sm">
        <Link
          href={{ pathname: '/applications', query: { competitionId: c.id } }}
          className="text-blue-700 hover:underline"
        >
          {t('myApplicationsHere')}
        </Link>
      </p>
    </Card>
  );
}
