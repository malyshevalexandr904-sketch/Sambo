'use client';
// Страница участника платформы (правки 07.11.2026, п. 8): то же, что участник видит в своём личном кабинете, —
// фото, ФИО, роли, клуб, возраст, город; у спортсмена — Elo, медали, схватки и турниры; у тренера и руководителя —
// команда; у судьи — категория, стаж, турниры и рейтинг. Открывается из поиска вверху кабинета.
import type { DataEnvelope, UserProfileDto } from '@sde/contracts';
import { Alert } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRankName } from '@/features/athletes/shared';
import { ageRange } from '@/features/divisions/shared';
import { CountUp } from '@/features/profile/animated';
import {
  type AthleteStats,
  type ProfileFact,
  ProfilePanel,
  ProfileView,
} from '@/features/profile/profile-view';
import { api, ApiError } from '@/lib/api';
import { RefereePanel } from './referee-panel';

export function usePersonProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['people', userId],
    queryFn: async () => (await api<DataEnvelope<UserProfileDto>>(`/people/${userId}`)).data,
    enabled: !!userId,
  });
}

function Counter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-5xl font-extrabold tabular-nums text-blue-800">
        <CountUp value={value} />
      </span>
      <span className="text-sm text-slate-600">{label}</span>
    </div>
  );
}

export function UserPage({ userId }: { userId: string }) {
  const t = useTranslations('directory');
  const tp = useTranslations('profile');
  const td = useTranslations('divisions');
  const rankName = useRankName();
  const q = usePersonProfile(userId);
  if (q.isPending)
    return <div className="mx-auto h-64 max-w-6xl animate-pulse rounded-2xl bg-slate-100" aria-busy="true" />;
  if (q.error)
    return (
      <Alert tone="danger" className="mx-auto max-w-xl">
        {q.error instanceof ApiError && q.error.status === 404 ? t('notFoundPage') : t('loadError')}
      </Alert>
    );
  const p = q.data;
  const a = p.athlete;
  const facts: ProfileFact[] = [
    ...(a?.club ? [{ icon: 'building' as const, label: tp('club'), value: a.club }] : []),
    ...(p.age !== null
      ? [{ icon: 'calendar' as const, label: tp('age'), value: tp('years', { n: p.age }) }]
      : []),
    ...(a?.coach ? [{ icon: 'whistle' as const, label: tp('coach'), value: a.coach }] : []),
    ...(a?.rankCode ? [{ icon: 'star' as const, label: tp('rank'), value: rankName(a.rankCode) }] : []),
    ...(p.city ? [{ icon: 'pin' as const, label: tp('city'), value: p.city }] : []),
  ];
  const stats: AthleteStats | undefined = a
    ? {
        rating: a.progress.rating,
        division: a.progress.division
          ? `${tp('division')}: ${a.progress.division.name} · ${ageRange(td, a.progress.division)}`
          : null,
        bouts: a.progress.bouts,
        medals: a.history.summary.medals,
        competitions: a.history.summary.competitions,
        results: a.history.results,
      }
    : undefined;
  const clubs = a?.club ? p.organizations.filter((o) => o.name !== a.club) : p.organizations;
  return (
    <ProfileView
      name={p.name}
      avatarUrl={p.avatarUrl}
      roleLabel={p.roles.length > 0 ? p.roles.map((r) => t(`roles.${r}`)).join(' · ') : null}
      facts={facts}
      athlete={stats}
      editHref={p.self ? '/settings?tab=profile' : undefined}
    >
      {p.referee ? <RefereePanel stats={p.referee} editable={p.self} /> : null}
      {p.head ? (
        <ProfilePanel title={tp('team')} icon="users" delay={80}>
          <div className="flex flex-wrap gap-8">
            <Counter value={p.head.athletes} label={tp('teamAthletes', { n: p.head.athletes })} />
            <Counter value={p.head.coaches} label={tp('teamCoaches', { n: p.head.coaches })} />
          </div>
        </ProfilePanel>
      ) : p.coach ? (
        <ProfilePanel title={tp('team')} icon="users" delay={80}>
          <Counter value={p.coach.athletes} label={tp('teamAthletes', { n: p.coach.athletes })} />
        </ProfilePanel>
      ) : null}
      {clubs.length > 0 ? (
        <ProfilePanel title={tp('organizations')} icon="building" delay={120}>
          <ul className="space-y-2">
            {clubs.map((o) => (
              <li key={o.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800">
                {o.name}
              </li>
            ))}
          </ul>
        </ProfilePanel>
      ) : null}
    </ProfileView>
  );
}
