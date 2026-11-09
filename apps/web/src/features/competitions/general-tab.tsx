'use client';
// Вкладка «Общее» для администратора, который проводит турнир (правки 09.11.2026, п. 3): ручное переключение стадий
// (регистрация → комиссия по допуску → взвешивание → жеребьёвка → проведение), все сведения и сроки турнира
// (регистрация, комиссия, взвешивание, жеребьёвка, схватки) и положение.
import {
  type Competition,
  type CompetitionDaySchedule,
  DAY_SCHEDULE_STEPS,
  type DayScheduleStep,
  stageOfCompetition,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { StageStepper } from '@/features/tournament/stage-stepper';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { EditCard } from './edit-card';
import { InfoCard, ReadinessCard, TransitionsCard } from './overview';
import { RatingCard } from './rating-card';
import { RegulationTab } from './regulation';
import { MediaCard, PresentationCard } from './stage-guide';
import { formatInZone } from './shared';

const MEDIA: readonly string[] = ['FINISHED', 'ARCHIVED'];

export function GeneralTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('general');
  const can = (a: string): boolean => c.allowedActions.includes(a);
  const stage = stageOfCompetition(c.status);
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>{t('stageTitle')}</CardTitle>
        <StageStepper stage={stage} variant="manage" />
        <p className="mt-3 text-sm text-slate-600">{t(`stageHint.${stage ?? 'DRAFT'}`)}</p>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        {c.allowedActions.some((a) => a.startsWith('transition:')) ? (
          <TransitionsCard competition={c} />
        ) : null}
        {c.status === 'DRAFT' && can('competition.update') ? <ReadinessCard competition={c} /> : null}
        <InfoCard competition={c} />
        <TimelineCard competition={c} />
        <RatingCard competition={c} />
        {can('competition.update') ? <EditCard competition={c} /> : null}
        {can('competition.update') && c.status !== 'CANCELLED' ? <PresentationCard competition={c} /> : null}
        {can('competition.update') && MEDIA.includes(c.status) ? <MediaCard competition={c} /> : null}
      </div>
      <section aria-labelledby="general-regulation">
        <h2 id="general-regulation" className="mb-3 text-lg font-semibold">
          {t('regulationTitle')}
        </h2>
        <RegulationTab competition={c} />
      </section>
    </div>
  );
}

/** Сроки этапов: регистрация (поля турнира) и этапы дня соревнований — в местном времени турнира. */
function TimelineCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('general.timeline');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const action = useAction();
  const canEdit = c.allowedActions.includes('competition.update') && c.status !== 'CANCELLED';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CompetitionDaySchedule>(c.daySchedule);
  const [saved, setSaved] = useState(false);
  const show = (v: string | null | undefined): string =>
    v
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
          new Date(`${v}:00Z`),
        )
      : '—';
  const period = (step: DayScheduleStep): string => {
    const p = c.daySchedule[step];
    if (!p?.from && !p?.to) return t('notSet');
    return `${show(p?.from)} — ${show(p?.to)}`;
  };
  const set = (step: DayScheduleStep, key: 'from' | 'to', value: string): void => {
    setSaved(false);
    setForm((f) => ({
      ...f,
      [step]: { from: f[step]?.from ?? null, to: f[step]?.to ?? null, [key]: value || null },
    }));
  };
  const save = (): void => {
    void action.run(async () => {
      await api(`/competitions/${c.id}/presentation`, { method: 'PUT', body: { daySchedule: form } });
      await queryClient.invalidateQueries({ queryKey: qk.competition(c.id) });
      setSaved(true);
      setEditing(false);
    });
  };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="mb-0">{t('title')}</CardTitle>
        {canEdit && !editing ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-slate-600">{t('timezone', { tz: c.timezone })}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      {saved ? (
        <p role="status" className="mb-2 text-sm text-green-800">
          {t('saved')}
        </p>
      ) : null}
      {!editing ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-600">{t('registration')}</dt>
          <dd>
            {formatInZone(c.registrationStartsAt, c.timezone, locale)} —{' '}
            {formatInZone(c.registrationEndsAt, c.timezone, locale)}
          </dd>
          {DAY_SCHEDULE_STEPS.map((step) => (
            <div key={step} className="contents">
              <dt className="text-slate-600">{t(`steps.${step}`)}</dt>
              <dd>{period(step)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {DAY_SCHEDULE_STEPS.map((step) => (
            <fieldset key={step} className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">{t(`steps.${step}`)}</legend>
              <Field id={`tl-${step}-from`} label={t('from')}>
                <Input
                  id={`tl-${step}-from`}
                  type="datetime-local"
                  value={form[step]?.from ?? ''}
                  onChange={(e) => set(step, 'from', e.target.value)}
                />
              </Field>
              <Field id={`tl-${step}-to`} label={t('to')}>
                <Input
                  id={`tl-${step}-to`}
                  type="datetime-local"
                  value={form[step]?.to ?? ''}
                  onChange={(e) => set(step, 'to', e.target.value)}
                />
              </Field>
            </fieldset>
          ))}
          <p className="text-xs text-slate-600">{t('registrationHint')}</p>
          <div className="flex gap-2">
            <Button type="submit" loading={action.busy}>
              {t('save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(c.daySchedule);
                setEditing(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
