'use client';
// Клуб, тренер и разряды спортсмена: периоды с датами начала и окончания (DATABASE.md, 3.3).
import {
  type Athlete,
  type CoachSummary,
  type DataEnvelope,
  type Page,
  type RankRecordDto,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { fieldErrors } from '@/components/person-fields';
import { api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { pickName, qk, useSportRanks } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { useAthleteCache, useClubsWith, useRankName } from './shared';

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Завершение периода датой (по умолчанию — сегодня). */
function EndPeriod({ label, onEnd }: { label: string; onEnd: (validTo: string) => Promise<void> }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const action = useAction();
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        aria-label={label}
        type="date"
        value={date}
        className="w-40"
        onChange={(e) => setDate(e.target.value)}
      />
      <Button
        size="sm"
        loading={action.busy}
        onClick={() => void action.run(() => onEnd(date).then(() => setOpen(false)))}
      >
        {t('confirm')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t('cancel')}
      </Button>
      {action.error ? <p className="w-full text-sm text-red-700">{action.error}</p> : null}
    </div>
  );
}

export function ClubPanel({ athlete, editable }: { athlete: Athlete; editable: boolean }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const setAthlete = useAthleteCache(athlete.id);
  const clubs = useClubsWith('athlete.create');
  const clubId = athlete.currentClub?.id ?? '';
  const coaches = useQuery({
    queryKey: qk.coaches({ organizationId: clubId }),
    queryFn: () =>
      api<Page<CoachSummary>>('/coaches', {
        query: { organizationId: clubId, limit: 100, status: 'ACTIVE' },
      }),
    enabled: editable && clubId !== '',
  });
  const [membership, setMembership] = useState({ organizationId: '', validFrom: todayIso() });
  const [coach, setCoach] = useState({ coachId: '', validFrom: todayIso() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addMembership = useAction();
  const addCoach = useAction();
  const post = async (path: string, body: unknown): Promise<void> => {
    const res = await api<DataEnvelope<Athlete>>(`/athletes/${athlete.id}${path}`, { method: 'POST', body });
    setAthlete(res.data);
  };
  const withErrors = async (fn: () => Promise<void>): Promise<void> => {
    setErrors({});
    try {
      await fn();
    } catch (e) {
      setErrors(fieldErrors(e));
      throw e;
    }
  };

  return (
    <Card>
      <CardTitle>{t('athletes.clubAndCoach')}</CardTitle>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('athletes.memberships')}</h3>
      <ul className="mb-4 space-y-2 text-sm">
        {athlete.memberships.length === 0 ? <li className="text-slate-600">{t('athletes.noClub')}</li> : null}
        {athlete.memberships.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{m.organization.shortName}</span>
            {m.isPrimary ? <Badge tone="info">{t('athletes.primary')}</Badge> : null}
            <span className="text-slate-600">
              {formatDate(m.validFrom, locale)} —{' '}
              {m.validTo ? formatDate(m.validTo, locale) : t('athletes.now')}
            </span>
            {editable && m.active ? (
              <EndPeriod
                label={t('athletes.endPeriod')}
                onEnd={(validTo) => post(`/memberships/${m.id}/end`, { validTo })}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <form
          className="mb-6 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void addMembership.run(() =>
              withErrors(() => post('/memberships', { ...membership, isPrimary: true })),
            );
          }}
        >
          <Field id="transfer-org" label={t('athletes.transferTo')} error={tf(errors.organizationId)}>
            <Select
              id="transfer-org"
              value={membership.organizationId}
              onChange={(e) => setMembership({ ...membership, organizationId: e.target.value })}
            >
              <option value="">—</option>
              {clubs.data
                .filter((o) => o.id !== clubId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="transfer-from" label={t('organizations.validFrom')} error={tf(errors.validFrom)}>
            <Input
              id="transfer-from"
              type="date"
              value={membership.validFrom}
              onChange={(e) => setMembership({ ...membership, validFrom: e.target.value })}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={!membership.organizationId}
            loading={addMembership.busy}
          >
            {t('athletes.transfer')}
          </Button>
          {addMembership.error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {addMembership.error}
            </Alert>
          ) : null}
          <p className="text-xs text-slate-500 sm:col-span-2">{t('athletes.transferHint')}</p>
        </form>
      ) : null}

      <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('athletes.coaches')}</h3>
      <ul className="mb-4 space-y-2 text-sm">
        {athlete.coaches.length === 0 ? <li className="text-slate-600">{t('athletes.noCoach')}</li> : null}
        {athlete.coaches.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.coach.name}</span>
            {c.isPrimary ? <Badge tone="info">{t('athletes.primary')}</Badge> : null}
            <span className="text-slate-600">
              {formatDate(c.validFrom, locale)} —{' '}
              {c.validTo ? formatDate(c.validTo, locale) : t('athletes.now')}
            </span>
            {editable && c.active ? (
              <EndPeriod
                label={t('athletes.endPeriod')}
                onEnd={(validTo) => post(`/coaches/${c.id}/end`, { validTo })}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {editable && clubId ? (
        <form
          className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void addCoach.run(() => withErrors(() => post('/coaches', { ...coach, isPrimary: true })));
          }}
        >
          <Field id="coach-add" label={t('athletes.assignCoach')} error={tf(errors.coachId)}>
            <Select
              id="coach-add"
              value={coach.coachId}
              onChange={(e) => setCoach({ ...coach, coachId: e.target.value })}
            >
              <option value="">—</option>
              {(coaches.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="coach-from" label={t('organizations.validFrom')} error={tf(errors.validFrom)}>
            <Input
              id="coach-from"
              type="date"
              value={coach.validFrom}
              onChange={(e) => setCoach({ ...coach, validFrom: e.target.value })}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!coach.coachId} loading={addCoach.busy}>
            {t('athletes.assign')}
          </Button>
          {addCoach.error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {addCoach.error}
            </Alert>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

export function RanksPanel({ athlete, editable }: { athlete: Athlete; editable: boolean }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const rankName = useRankName();
  const ranks = useSportRanks();
  const history = useQuery({
    queryKey: qk.athleteRanks(athlete.id),
    queryFn: async () => (await api<DataEnvelope<RankRecordDto[]>>(`/athletes/${athlete.id}/ranks`)).data,
  });
  const [draft, setDraft] = useState({ sportRankCode: '', assignedAt: '', orderRef: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAction();
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.athleteRanks(athlete.id) });
    await queryClient.invalidateQueries({ queryKey: qk.athlete(athlete.id) });
  };
  return (
    <Card>
      <CardTitle>{t('athletes.ranks')}</CardTitle>
      <ul className="mb-4 space-y-2 text-sm">
        {(history.data ?? []).length === 0 ? (
          <li className="text-slate-600">{t('athletes.noRank')}</li>
        ) : null}
        {(history.data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <span className={r.revokedAt ? 'text-slate-500 line-through' : 'font-medium'}>
              {rankName(r.sportRankCode)}
            </span>
            <span className="text-slate-600">
              {formatDate(r.assignedAt, locale)}
              {r.orderRef ? ` · ${r.orderRef}` : ''}
            </span>
            {r.revokedAt ? (
              <Badge tone="neutral">
                {t('athletes.revoked')}: {r.revokeReason}
              </Badge>
            ) : editable ? (
              <ReasonAction
                label={t('athletes.revokeRank')}
                title={t('athletes.revokeRankTitle')}
                size="sm"
                onConfirm={async (reason) => {
                  await api(`/athletes/${athlete.id}/ranks/${r.id}/revoke`, {
                    method: 'POST',
                    body: { reason },
                  });
                  await refresh();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <form
          noValidate
          className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            void add.run(async () => {
              try {
                await api(`/athletes/${athlete.id}/ranks`, {
                  method: 'POST',
                  body: {
                    sportRankCode: draft.sportRankCode,
                    assignedAt: draft.assignedAt,
                    ...(draft.orderRef.trim() ? { orderRef: draft.orderRef.trim() } : {}),
                  },
                });
                setDraft({ sportRankCode: '', assignedAt: '', orderRef: '' });
                await refresh();
              } catch (err) {
                setErrors(fieldErrors(err));
                throw err;
              }
            });
          }}
        >
          <Field id="rank-code" label={t('athletes.rank')} error={tf(errors.sportRankCode)}>
            <Select
              id="rank-code"
              value={draft.sportRankCode}
              onChange={(e) => setDraft({ ...draft, sportRankCode: e.target.value })}
            >
              <option value="">—</option>
              {(ranks.data ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {pickName(r.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="rank-at" label={t('athletes.rankAssignedAt')} error={tf(errors.assignedAt)}>
            <Input
              id="rank-at"
              type="date"
              value={draft.assignedAt}
              onChange={(e) => setDraft({ ...draft, assignedAt: e.target.value })}
            />
          </Field>
          <Field id="rank-order" label={t('athletes.rankOrderRef')} error={tf(errors.orderRef)}>
            <Input
              id="rank-order"
              value={draft.orderRef}
              onChange={(e) => setDraft({ ...draft, orderRef: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="secondary"
              disabled={!draft.sportRankCode || !draft.assignedAt}
              loading={add.busy}
            >
              {t('athletes.addRank')}
            </Button>
          </div>
          {add.error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {add.error}
            </Alert>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
