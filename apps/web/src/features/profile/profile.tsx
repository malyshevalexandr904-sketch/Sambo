'use client';
// Личный кабинет (правки 05.11.2026, п. 4, 5): страница профиля в духе соцсети вместо сводки с блоком «Работа».
// Разделы роли теперь во вкладках меню (lib/sections.ts), настройки профиля и безопасности — в «Настройках».
import {
  type Athlete,
  type AthleteSummary,
  type AthleteRatingProgress,
  type CoachSummary,
  type DataEnvelope,
  fullYearsOn,
  type Me,
  type Page,
  type PersonDto,
} from '@sde/contracts';
import { Alert } from '@sde/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AthleteProgressCard } from '@/features/athletes/rating-progress';
import { useClubsWith, useRankName } from '@/features/athletes/shared';
import { ageRange } from '@/features/divisions/shared';
import { useAthleteHistory } from '@/features/results/api';
import { MyWeighInQr } from '@/features/tournament/weigh-in-qr';
import { RefereePanel } from '@/features/people/referee-panel';
import { usePersonProfile } from '@/features/people/user-page';
import { CountUp } from './animated';
import { OrganizationsList } from './organizations';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { qk, useMe, useMyAthletes } from '@/lib/queries';

import { type AthleteStats, type ProfileFact, ProfilePanel, ProfileView } from './profile-view';

const SETTINGS_PROFILE = '/settings?tab=profile';
const TEAM_LIMIT = 100;

function useMyPerson(enabled: boolean) {
  return useQuery({
    queryKey: ['me', 'person'],
    queryFn: async () => (await api<DataEnvelope<PersonDto | null>>('/me/person')).data,
    enabled,
  });
}

function useAgeFact(birthDate: string | null | undefined): ProfileFact | null {
  const t = useTranslations('profile');
  if (!birthDate) return null;
  const age = fullYearsOn(birthDate, new Date().toISOString().slice(0, 10));
  return { icon: 'calendar', label: t('age'), value: t('years', { n: age }) };
}

function OrganizationsPanel({ me }: { me: Me }) {
  const t = useTranslations('profile');
  return (
    <ProfilePanel title={t('organizations')} icon="building" delay={120}>
      <OrganizationsList me={me} />
      <Link
        href="/settings?tab=organizations"
        className="mt-3 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
      >
        {t('manageOrganizations')}
      </Link>
    </ProfilePanel>
  );
}

/** Счётчик команды с переходом во вкладку. */
function TeamCounter({
  count,
  more,
  pending,
  label,
  href,
  linkLabel,
}: {
  count: number;
  more: boolean;
  pending: boolean;
  label: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4">
        <span className="text-5xl font-extrabold tabular-nums text-blue-800">
          {pending ? '…' : <CountUp value={count} />}
          {more ? '+' : ''}
        </span>
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <Link
        href={href}
        className="mt-4 inline-flex min-h-11 items-center self-start rounded-md px-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

/**
 * Команда тренера или руководителя: сколько спортсменов, со ссылкой на вкладку «Мои спортсмены»; у руководителя
 * рядом — сколько тренеров, со ссылкой на «Мои тренеры» (правки 07.11.2026, п. 6).
 */
function TeamPanel({ coach }: { coach: boolean }) {
  const t = useTranslations('profile');
  const params = { ...(coach ? { mine: 'true' } : {}), limit: TEAM_LIMIT };
  const list = useQuery({
    queryKey: qk.athletes(params),
    queryFn: () => api<Page<AthleteSummary>>('/athletes', { query: params }),
  });
  const clubs = useClubsWith('coach.manage');
  const clubIds = coach ? [] : clubs.data.map((c) => c.id);
  const coaches = useQueries({
    queries: clubIds.map((organizationId) => {
      const q = { organizationId, status: 'ACTIVE', limit: TEAM_LIMIT };
      return {
        queryKey: qk.coaches(q),
        queryFn: () => api<Page<CoachSummary>>('/coaches', { query: q }),
      };
    }),
  });
  const count = list.data?.data.length ?? 0;
  const coachIds = new Set(coaches.flatMap((c) => (c.data?.data ?? []).map((x) => x.id)));
  return (
    <ProfilePanel title={t('team')} icon="users" delay={80}>
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <TeamCounter
          count={count}
          more={!!list.data?.page.nextCursor}
          pending={list.isPending}
          label={t('teamAthletes', { n: count })}
          href="/athletes"
          linkLabel={t('openAthletes')}
        />
        {coach ? null : (
          <TeamCounter
            count={coachIds.size}
            more={coaches.some((c) => !!c.data?.page.nextCursor)}
            pending={clubs.isPending || coaches.some((c) => c.isPending)}
            label={t('teamCoaches', { n: coachIds.size })}
            href="/coaches"
            linkLabel={t('openCoaches')}
          />
        )}
      </div>
    </ProfilePanel>
  );
}

/** Судья: категория, стаж, отсуженные турниры и рейтинг (правки 07.11.2026, п. 10). */
function RefereeSection({ userId }: { userId: string }) {
  const q = usePersonProfile(userId);
  if (!q.data?.referee) return null;
  return <RefereePanel stats={q.data.referee} editable />;
}

/** Профиль спортсмена: свои данные, рейтинг, медали и выступления. */
function AthleteProfile({ me, athleteId, base }: { me: Me; athleteId: string; base: ProfileFact[] }) {
  const t = useTranslations('profile');
  const td = useTranslations('divisions');
  const rankName = useRankName();
  const athlete = useQuery({
    queryKey: qk.athlete(athleteId),
    queryFn: async () => (await api<DataEnvelope<Athlete>>(`/athletes/${athleteId}`)).data,
  });
  const progress = useQuery({
    queryKey: ['athletes', athleteId, 'rating-progress'],
    queryFn: async () =>
      (await api<DataEnvelope<AthleteRatingProgress>>(`/athletes/${athleteId}/rating-progress`)).data,
  });
  const history = useAthleteHistory(athleteId);
  const a = athlete.data;
  const facts: ProfileFact[] = [
    ...(a?.currentClub ? [{ icon: 'building' as const, label: t('club'), value: a.currentClub.name }] : []),
    ...base,
    ...(a?.currentCoach ? [{ icon: 'whistle' as const, label: t('coach'), value: a.currentCoach.name }] : []),
    ...(a?.currentRank
      ? [{ icon: 'star' as const, label: t('rank'), value: rankName(a.currentRank.code) }]
      : []),
    ...(a?.person.city ? [{ icon: 'pin' as const, label: t('city'), value: a.person.city }] : []),
  ];
  const p = progress.data;
  const h = history.data;
  const failed = progress.isError && history.isError;
  const stats: AthleteStats | 'loading' =
    progress.isPending || history.isPending
      ? 'loading'
      : {
          rating: p?.rating ?? null,
          division: p?.division ? `${t('division')}: ${p.division.name} · ${ageRange(td, p.division)}` : null,
          bouts: p?.bouts ?? [],
          medals: h?.summary.medals ?? { GOLD: 0, SILVER: 0, BRONZE: 0 },
          competitions: h?.summary.competitions ?? 0,
          results: h?.results ?? [],
        };
  return (
    <>
      {failed ? (
        <Alert tone="danger" className="mb-4">
          {t('loadError')}
        </Alert>
      ) : null}
      <ProfileView
        name={
          a
            ? [a.person.lastName, a.person.firstName, a.person.middleName].filter(Boolean).join(' ')
            : me.displayName
        }
        avatarUrl={me.avatarUrl}
        roleLabel={t('roleAthlete')}
        facts={facts}
        athlete={stats}
        editHref={SETTINGS_PROFILE}
      />
    </>
  );
}

export function ProfilePage() {
  const t = useTranslations();
  const { data: me } = useMe();
  const role = me?.activeRole ?? null;
  const person = useMyPerson(!!me?.personId);
  const mine = useMyAthletes(!!me?.personId);
  const ageFact = useAgeFact(person.data?.birthDate);
  if (!me) return null;
  const self = mine.data?.find((a) => a.relation === 'SELF');
  const base = ageFact ? [ageFact] : [];
  const fullName = person.data
    ? [person.data.lastName, person.data.firstName, person.data.middleName].filter(Boolean).join(' ')
    : me.displayName;

  const alerts = (
    <>
      {role === null ? (
        <Alert tone="info" className="mb-6" title={t('dashboard.noRoleTitle')}>
          {t('dashboard.noRole')}{' '}
          <Link href="/onboarding" className="font-medium underline">
            {t('cabinetRole.chooseRole')}
          </Link>
        </Alert>
      ) : null}
      {me.grants.platform.length > 0 && !me.totpEnabled ? (
        <Alert tone="warning" className="mb-6">
          {t('dashboard.totpWarning')}{' '}
          <Link href="/settings?tab=security" className="font-medium underline">
            {t('profile.openSecurity')}
          </Link>
        </Alert>
      ) : null}
      {/* Мандатная комиссия и взвешивание турнира: QR участия для судьи на весах. */}
      {role === 'ATHLETE' || role === 'GUARDIAN' ? <MyWeighInQr /> : null}
    </>
  );

  if (role === 'ATHLETE') {
    return (
      <>
        {alerts}
        {self ? (
          <AthleteProfile me={me} athleteId={self.athleteId} base={base} />
        ) : (
          <ProfileView
            name={fullName}
            avatarUrl={me.avatarUrl}
            roleLabel={t('profile.roleAthlete')}
            facts={base}
            athlete={mine.isPending ? 'loading' : 'pending'}
            editHref={SETTINGS_PROFILE}
          />
        )}
      </>
    );
  }

  const showOrganizations =
    me.grants.organizations.length > 0 || role === 'ORGANIZATION_HEAD' || role === 'ADMIN';
  const children =
    role === 'GUARDIAN' ? (mine.data ?? []).filter((a) => a.relation !== 'SELF' && a.verified) : [];
  const facts: ProfileFact[] = [
    ...base,
    ...(person.data?.city
      ? [{ icon: 'pin' as const, label: t('profile.city'), value: person.data.city }]
      : []),
    ...(me.grants.platform.length > 0
      ? [
          {
            icon: 'shield' as const,
            label: t('dashboard.platformRoles'),
            value: me.grants.platform.map((r) => t(`roles.${r}`)).join(', '),
          },
        ]
      : []),
  ];
  return (
    <>
      {alerts}
      <ProfileView
        name={fullName}
        avatarUrl={me.avatarUrl}
        roleLabel={role ? t(`cabinetRole.roles.${role}`) : null}
        facts={facts}
        editHref={SETTINGS_PROFILE}
      >
        {role === 'REFEREE' ? <RefereeSection userId={me.id} /> : null}
        {role === 'COACH' || role === 'ORGANIZATION_HEAD' ? <TeamPanel coach={role === 'COACH'} /> : null}
        {showOrganizations ? <OrganizationsPanel me={me} /> : null}
        {children.map((c) => (
          <AthleteProgressCard
            key={c.athleteId}
            athleteId={c.athleteId}
            title={t('athleteProgress.childTitle', { name: c.publicName })}
          />
        ))}
      </ProfileView>
    </>
  );
}
