'use client';
// Участники организации и приглашения (API.md, 3.4).
import { type DataEnvelope, type Membership, ORGANIZATION_ROLE_CODES, type Page } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

function InviteForm({
  organizationId,
  onInvited,
}: {
  organizationId: string;
  onInvited: () => Promise<void>;
}) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState<string>('COACH');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  return (
    <form
      className="mt-4 space-y-3 border-t border-slate-100 pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          await api<DataEnvelope<Membership>>(`/organizations/${organizationId}/members`, {
            method: 'POST',
            body: { email, roleCode },
          });
          setEmail('');
          setMessage({ tone: 'success', text: t('organizations.invited') });
          await onInvited();
        } catch (err) {
          setMessage({ tone: 'danger', text: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-medium">{t('organizations.inviteTitle')}</p>
      <p className="text-sm text-slate-600">{t('organizations.inviteHint')}</p>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field id="invite-email" label={t('auth.email')}>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="invite-role" label={t('users.role')}>
          <Select id="invite-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
            {ORGANIZATION_ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={busy}>
          {t('organizations.invite')}
        </Button>
      </div>
    </form>
  );
}

export function MembersPanel({ organizationId, canManage }: { organizationId: string; canManage: boolean }) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({
    queryKey: qk.members(organizationId),
    queryFn: () =>
      api<Page<Membership>>(`/organizations/${organizationId}/members`, { query: { limit: 100 } }),
  });
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: qk.members(organizationId) });
  const change = async (m: Membership, status: 'ACTIVE' | 'SUSPENDED' | 'ENDED'): Promise<void> => {
    setError(null);
    try {
      await api(`/organizations/${organizationId}/members/${m.id}`, {
        method: 'PATCH',
        version: m.version,
        body: { status },
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('organizations.members')}</CardTitle>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <QueryState isPending={members.isPending} error={members.error}>
        {() => (
          <ul className="divide-y divide-slate-100">
            {(members.data?.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{m.user?.displayName ?? m.invitedEmail}</p>
                  <p className="text-sm text-slate-600">
                    {t(`roles.${m.roleCode}`)} {m.user?.email ? `· ${m.user.email}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={m.status} />
                  {canManage && m.status === 'ACTIVE' ? (
                    <Button size="sm" variant="secondary" onClick={() => void change(m, 'SUSPENDED')}>
                      {t('organizations.suspend')}
                    </Button>
                  ) : null}
                  {canManage && m.status === 'SUSPENDED' ? (
                    <Button size="sm" variant="secondary" onClick={() => void change(m, 'ACTIVE')}>
                      {t('organizations.activate')}
                    </Button>
                  ) : null}
                  {canManage && m.status !== 'ENDED' ? (
                    <Button size="sm" variant="danger" onClick={() => void change(m, 'ENDED')}>
                      {t('organizations.end')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {canManage ? <InviteForm organizationId={organizationId} onInvited={refresh} /> : null}
    </Card>
  );
}
