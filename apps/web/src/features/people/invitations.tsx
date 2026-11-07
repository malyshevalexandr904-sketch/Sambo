'use client';
// Приглашения в персонал турнира (правки 07.11.2026, п. 15): приходят уведомлением на платформе, а не письмом.
// Здесь приглашённый принимает приглашение (роль начинает действовать, кабинет переключается на неё) или отказывается.
import type { DataEnvelope, MyCompetitionInviteDto } from '@sde/contracts';
import { Alert, Button, EmptyState, PageHeader } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { formatDates } from '@/features/competitions/shared';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export const INVITES_KEY = ['competition-invites', 'mine'] as const;

export function useMyInvites() {
  return useQuery({
    queryKey: INVITES_KEY,
    queryFn: async () =>
      (await api<DataEnvelope<MyCompetitionInviteDto[]>>('/competition-invites/mine')).data,
    staleTime: 30_000,
  });
}

export function Invitations() {
  const t = useTranslations('invitations');
  const tr = useTranslations('roles');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const list = useMyInvites();
  const action = useAction();
  const respond = (id: string, verb: 'accept' | 'decline') =>
    action.run(async () => {
      await api(`/competition-invites/${id}/${verb}`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: INVITES_KEY });
      if (verb === 'accept') await queryClient.invalidateQueries({ queryKey: qk.me });
    });
  return (
    <>
      <PageHeader title={t('title')} description={t('hint')} />
      {action.error ? (
        <Alert tone="danger" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      <QueryState isPending={list.isPending} error={list.error}>
        {() =>
          (list.data ?? []).length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="space-y-3">
              {(list.data ?? []).map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      <Link href={`/competitions/${inv.competition.id}`} className="hover:underline">
                        {inv.competition.name}
                      </Link>
                    </p>
                    <p className="text-sm text-slate-600">
                      {formatDates(inv.competition.startDate, inv.competition.endDate, locale)} ·{' '}
                      {t('role', { role: tr(inv.roleCode) })}
                    </p>
                    {inv.invitedBy ? (
                      <p className="text-xs text-slate-500">{t('invitedBy', { name: inv.invitedBy })}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button loading={action.busy} onClick={() => void respond(inv.id, 'accept')}>
                      {t('accept')}
                    </Button>
                    <Button
                      variant="secondary"
                      loading={action.busy}
                      onClick={() => void respond(inv.id, 'decline')}
                    >
                      {t('decline')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}
