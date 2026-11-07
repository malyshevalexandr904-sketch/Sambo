'use client';
// Персонал турнира (API.md, 5.1; D-07): приглашение пользователя платформы, приостановка и завершение. Себе роль в
// турнире не назначают — это проверяет сервер (FORBIDDEN, self_assignment). Правки 07.11.2026: приглашают найденного
// по ФИО участника — приглашение приходит ему уведомлением на платформе, не письмом (п. 15); «Набор судей» — здесь же,
// под персоналом (п. 16); организатор оценивает отработавших судей звёздами (п. 10).
import {
  COMPETITION_ROLE_CODES,
  type Competition,
  type CompetitionMember,
  type CompetitionRefereeRatingDto,
  type DataEnvelope,
  type Page,
  REFEREE_RATING_STATUSES,
  type UserSearchItem,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Select, Table, Td, Th } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { Link } from '@/i18n/navigation';
import { UserPicker } from '@/features/people/user-picker';
import { RecruitmentTab } from './recruitment';

const NEXT: Record<CompetitionMember['status'], CompetitionMember['status'][]> = {
  INVITED: ['ENDED'],
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

export function StaffTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const canManage = c.allowedActions.includes('competition.members.manage');
  const [showEnded, setShowEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({
    queryKey: qk.competitionMembers(c.id),
    queryFn: async () =>
      (await api<Page<CompetitionMember>>(`/competitions/${c.id}/members`, { query: { limit: 100 } })).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.competitionMembers(c.id) });
  const change = async (m: CompetitionMember, status: CompetitionMember['status']): Promise<void> => {
    setError(null);
    try {
      await api(`/competitions/${c.id}/members/${m.id}`, {
        method: 'PATCH',
        body: { status },
        version: m.version,
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const rows = (members.data ?? []).filter((m) => showEnded || m.status !== 'ENDED');
  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('competitions.staff.title')}</CardTitle>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={showEnded}
              onChange={(e) => setShowEnded(e.target.checked)}
            />
            {t('competitions.staff.showEnded')}
          </label>
        </div>
        <p className="mb-3 text-sm text-slate-600">{t('competitions.staff.hint')}</p>
        {error ? (
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
        ) : null}
        <QueryState isPending={members.isPending} error={members.error}>
          {() =>
            rows.length === 0 ? (
              <EmptyState title={t('competitions.staff.empty')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('competitions.staff.person')}</Th>
                    <Th>{t('users.role')}</Th>
                    <Th>{t('competitions.staff.status')}</Th>
                    {canManage ? <Th>{t('competitions.staff.actions')}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        {m.user ? (
                          <Link href={`/people/${m.user.id}`} className="font-medium hover:underline">
                            {m.user.displayName}
                          </Link>
                        ) : (
                          <p className="font-medium">{m.invitedEmail}</p>
                        )}
                        {m.user?.email ? <p className="text-xs text-slate-500">{m.user.email}</p> : null}
                      </Td>
                      <Td>{t(`roles.${m.roleCode}`)}</Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      {canManage ? (
                        <Td>
                          <div className="flex flex-wrap gap-2">
                            {NEXT[m.status].map((to) => (
                              <Button
                                key={to}
                                size="sm"
                                variant={to === 'ENDED' ? 'danger' : 'secondary'}
                                onClick={() => void change(m, to)}
                              >
                                {t(`competitions.staff.to.${to}`)}
                              </Button>
                            ))}
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </QueryState>
      </Card>
      {canManage ? <InviteCard competitionId={c.id} onInvited={refresh} /> : null}
      {canManage && (REFEREE_RATING_STATUSES as readonly string[]).includes(c.status) ? (
        <RefereeRatingsCard competitionId={c.id} />
      ) : null}
      {canManage ? <RecruitmentTab competition={c} /> : null}
    </div>
  );
}

function InviteCard({ competitionId, onInvited }: { competitionId: string; onInvited: () => Promise<void> }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [user, setUser] = useState<UserSearchItem | null>(null);
  const [roleCode, setRoleCode] = useState<string>(COMPETITION_ROLE_CODES[0] ?? 'TOURNAMENT_MANAGER');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  return (
    <Card>
      <CardTitle>{t('competitions.staff.inviteTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('competitions.staff.inviteHint')}</p>
      {message ? (
        <Alert tone={message.tone} className="mb-3">
          {message.text}
        </Alert>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return;
          setBusy(true);
          setMessage(null);
          try {
            await api<DataEnvelope<CompetitionMember>>(`/competitions/${competitionId}/members`, {
              method: 'POST',
              body: { userId: user.userId, roleCode },
            });
            setUser(null);
            setMessage({ tone: 'success', text: t('competitions.staff.invited') });
            await onInvited();
          } catch (err) {
            setMessage({ tone: 'danger', text: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <UserPicker id="staff-user" label={t('competitions.staff.person')} value={user} onChange={setUser} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="staff-role" label={t('users.role')}>
            <Select id="staff-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {COMPETITION_ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy} disabled={!user}>
            {t('competitions.staff.invite')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Оценки судей организатором: 1–5 звёзд, повторный выбор заменяет оценку (правки 07.11.2026, п. 10). */
function RefereeRatingsCard({ competitionId }: { competitionId: string }) {
  const t = useTranslations('competitions.staff.ratings');
  const queryClient = useQueryClient();
  const action = useAction();
  const key = ['competitions', competitionId, 'referee-ratings'] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: async () =>
      (
        await api<DataEnvelope<CompetitionRefereeRatingDto[]>>(
          `/competitions/${competitionId}/referee-ratings`,
        )
      ).data,
  });
  const rate = (userId: string, stars: number) =>
    action.run(async () => {
      const res = await api<DataEnvelope<CompetitionRefereeRatingDto[]>>(
        `/competitions/${competitionId}/referee-ratings/${userId}`,
        { method: 'PUT', body: { stars } },
      );
      queryClient.setQueryData(key, res.data);
    });
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          (list.data ?? []).length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="divide-y divide-slate-200">
              {(list.data ?? []).map((r) => (
                <li key={r.userId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span
                    className="flex items-center gap-1"
                    role="radiogroup"
                    aria-label={t('label', { name: r.name })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={r.stars === n}
                        aria-label={t('stars', { n })}
                        disabled={action.busy}
                        onClick={() => void rate(r.userId, n)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-2xl leading-none hover:bg-amber-50"
                      >
                        <span
                          aria-hidden="true"
                          className={r.stars !== null && n <= r.stars ? 'text-amber-500' : 'text-slate-300'}
                        >
                          ★
                        </span>
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}
