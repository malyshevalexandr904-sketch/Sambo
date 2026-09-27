'use client';
// Персонал турнира (API.md, 5.1; D-07): приглашение по email или существующего пользователя, приостановка и
// завершение. Себе роль в турнире не назначают — это проверяет сервер (FORBIDDEN, self_assignment).
import {
  COMPETITION_ROLE_CODES,
  type Competition,
  type CompetitionMember,
  type DataEnvelope,
  type Page,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, Select, Table, Td, Th } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

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
                        <p className="font-medium">{m.user?.displayName ?? m.invitedEmail}</p>
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
    </div>
  );
}

function InviteCard({ competitionId, onInvited }: { competitionId: string; onInvited: () => Promise<void> }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
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
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            await api<DataEnvelope<CompetitionMember>>(`/competitions/${competitionId}/members`, {
              method: 'POST',
              body: { email: email.trim(), roleCode },
            });
            setEmail('');
            setMessage({ tone: 'success', text: t('competitions.staff.invited') });
            await onInvited();
          } catch (err) {
            setMessage({ tone: 'danger', text: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="staff-email" label={t('auth.email')}>
          <Input
            id="staff-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="staff-role" label={t('users.role')}>
          <Select id="staff-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
            {COMPETITION_ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={busy}>
          {t('competitions.staff.invite')}
        </Button>
      </form>
    </Card>
  );
}
