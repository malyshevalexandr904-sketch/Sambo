'use client';
// «Персонал» администратора (правки 09.11.2026, п. 3): кто на каком ковре и в какой должности. Должностей судей пока
// три: главный судья соревнований (доступ ко всем коврам и планшетам), руководитель ковра (планшет своего ковра,
// ведёт схватки) и арбитр — он же боковой судья: они постоянно меняются, поэтому на ковре два места «Арбитр».
// Поменять людей местами — выбрать других в списках и сохранить. Нет ковров — их создают здесь же одной кнопкой.
import {
  type Competition,
  type CompetitionMember,
  type MatCrewRole,
  type Page,
  zonedToInstant,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import {
  useCrewCandidates,
  useCrews,
  useInvalidateScheduling,
  useMats,
  useSessions,
} from '@/features/scheduling/shared';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

/** Места на ковре: руководитель ковра и два арбитра (арбитр и боковой судья — одна должность). */
const SEATS: { role: MatCrewRole; label: 'matChief' | 'arbiter1' | 'arbiter2' }[] = [
  { role: 'MAT_CHIEF', label: 'matChief' },
  { role: 'REFEREE', label: 'arbiter1' },
  { role: 'SIDE_JUDGE', label: 'arbiter2' },
];

export function MatsStaffCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('matsStaff');
  const mats = useMats(c.id);
  const sessions = useSessions(c.id);
  const crews = useCrews(c.id);
  const candidates = useCrewCandidates(c.id);
  const members = useQuery({
    queryKey: qk.competitionMembers(c.id),
    queryFn: async () =>
      (await api<Page<CompetitionMember>>(`/competitions/${c.id}/members`, { query: { limit: 100 } })).data,
  });
  const invalidate = useInvalidateScheduling(c.id);
  const canManage = c.allowedActions.includes('mat_assignment.manage');
  const [sessionId, setSessionId] = useState('');
  const pathname = usePathname();
  const chiefs = (members.data ?? []).filter(
    (m) => m.roleCode === 'CHIEF_REFEREE' && (m.status === 'ACTIVE' || m.status === 'INVITED'),
  );
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-slate-600">{t('hint')}</p>
      <section className="mb-4 rounded-lg bg-blue-50 p-3">
        <h3 className="text-sm font-semibold text-blue-900">{t('chief')}</h3>
        <p className="text-xs text-slate-600">{t('chiefHint')}</p>
        <p className="mt-1 font-medium">
          {chiefs.length > 0
            ? chiefs.map((m) => m.user?.displayName ?? m.invitedEmail).join(', ')
            : t('chiefNone')}
        </p>
      </section>
      <QueryState
        isPending={mats.isPending || sessions.isPending || crews.isPending || candidates.isPending}
        error={mats.error ?? sessions.error ?? crews.error ?? candidates.error}
      >
        {() => {
          const matList = [...(mats.data ?? [])]
            .filter((m) => m.isActive)
            .sort((a, b) => a.number - b.number);
          const sessionList = [...(sessions.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          if (matList.length === 0 || sessionList.length === 0)
            return <QuickMats competition={c} hasMats={matList.length > 0} onDone={invalidate} />;
          const session = sessionList.find((s) => s.id === sessionId) ?? sessionList[0];
          if (!session) return null;
          const referees = (candidates.data ?? []).filter((x) => x.roleCode !== 'SECRETARY');
          return (
            <div className="space-y-3">
              {sessionList.length > 1 ? (
                <Field id="ms-session" label={t('session')} className="max-w-sm">
                  <Select id="ms-session" value={session.id} onChange={(e) => setSessionId(e.target.value)}>
                    {sessionList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {referees.length === 0 ? <Alert tone="info">{t('noReferees')}</Alert> : null}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {matList.map((mat) => (
                  <MatSeats
                    key={`${session.id}-${mat.id}`}
                    competitionId={c.id}
                    sessionId={session.id}
                    matId={mat.id}
                    label={t('mat', { number: mat.number, name: mat.name ?? '' })}
                    canManage={canManage}
                    current={(crews.data ?? [])
                      .filter((a) => a.sessionId === session.id && a.matId === mat.id)
                      .map((a) => ({ role: a.role, userId: a.user.id }))}
                    candidates={referees}
                    onDone={invalidate}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-600">
                {t('moreRoles')}{' '}
                <Link href={{ pathname, query: { tab: 'crews' } }} className="text-blue-700 hover:underline">
                  {t('openCrews')}
                </Link>
              </p>
            </div>
          );
        }}
      </QueryState>
    </Card>
  );
}

function MatSeats({
  competitionId,
  sessionId,
  matId,
  label,
  canManage,
  current,
  candidates,
  onDone,
}: {
  competitionId: string;
  sessionId: string;
  matId: string;
  label: string;
  canManage: boolean;
  current: { role: MatCrewRole; userId: string }[];
  candidates: { id: string; displayName: string }[];
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('matsStaff');
  const action = useAction();
  const initial = Object.fromEntries(
    SEATS.map((s) => [s.role, current.find((a) => a.role === s.role)?.userId ?? '']),
  ) as Record<MatCrewRole, string>;
  const [form, setForm] = useState(initial);
  const dirty = SEATS.some((s) => form[s.role] !== initial[s.role]);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 font-semibold">{label}</p>
      <div className="space-y-2">
        {SEATS.map((s) => (
          <Field key={s.role} id={`seat-${sessionId}-${matId}-${s.role}`} label={t(s.label)}>
            <Select
              id={`seat-${sessionId}-${matId}-${s.role}`}
              disabled={!canManage}
              value={form[s.role]}
              onChange={(e) => setForm({ ...form, [s.role]: e.target.value })}
            >
              <option value="">{t('unassigned')}</option>
              {candidates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      {canManage ? (
        <Button
          className="mt-3"
          size="sm"
          disabled={!dirty}
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              // Остальные должности бригады (секретарь, хронометрист…) не трогаем — отправляем их как есть.
              const others = current.filter((a) => !SEATS.some((s) => s.role === a.role));
              await api(`/competitions/${competitionId}/mat-assignments`, {
                method: 'PUT',
                body: {
                  sessionId,
                  matId,
                  assignments: [
                    ...SEATS.map((s) => ({ role: s.role, userId: form[s.role] || null })),
                    ...others.map((a) => ({ role: a.role, userId: a.userId })),
                  ],
                },
              });
              await onDone();
            })
          }
        >
          {t('save')}
        </Button>
      ) : null}
    </div>
  );
}

/** Ковры и рабочая сессия на день соревнований — одной кнопкой, если их ещё нет. */
function QuickMats({
  competition: c,
  hasMats,
  onDone,
}: {
  competition: Competition;
  hasMats: boolean;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('matsStaff');
  const action = useAction();
  const [count, setCount] = useState('2');
  const n = Math.max(1, Math.min(20, Number.parseInt(count, 10) || 1));
  const canSetup = c.allowedActions.includes('schedule.manage');
  if (!canSetup) return <Alert tone="info">{t('noMats')}</Alert>;
  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (!hasMats)
            for (let i = 1; i <= n; i += 1)
              await api(`/competitions/${c.id}/mats`, { method: 'POST', body: { number: i } });
          const from = c.daySchedule.bouts?.from ?? `${c.startDate}T09:00`;
          const to = c.daySchedule.bouts?.to ?? `${c.endDate}T20:00`;
          await api(`/competitions/${c.id}/sessions`, {
            method: 'POST',
            body: {
              name: t('sessionName'),
              startsAt: zonedToInstant(from, c.timezone),
              endsAt: zonedToInstant(to, c.timezone),
            },
          });
          await onDone();
        });
      }}
    >
      <p className="text-sm">{hasMats ? t('noSession') : t('noMats')}</p>
      {!hasMats ? (
        <Field id="qm-count" label={t('matsCount')} className="max-w-40">
          <Input id="qm-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      ) : null}
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <Button type="submit" loading={action.busy}>
        {hasMats ? t('createSession') : t('createMats', { count: n })}
      </Button>
    </form>
  );
}
