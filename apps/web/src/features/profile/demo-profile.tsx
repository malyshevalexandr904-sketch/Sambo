'use client';
// Личный кабинет в демо-входе (правки 05.11.2026, п. 5): вместо справки — пример профиля с вымышленными данными,
// чтобы было видно, как кабинет выглядит после регистрации, и под ним призыв зарегистрироваться.
import type { CabinetRole } from '@sde/contracts';
import { useTranslations } from 'next-intl';
import { DemoCta } from '@/components/demo-guide';
import { Icon } from '@/components/icons';
import { exampleAthleteStats } from './example';
import { type ProfileFact, ProfilePanel, ProfileView } from './profile-view';

type DemoRole = 'ORGANIZATION_HEAD' | 'COACH' | 'ATHLETE' | 'REFEREE';

export function DemoProfile({ role }: { role: CabinetRole | null }) {
  const t = useTranslations('profile');
  const tr = useTranslations('cabinetRole.roles');
  const r: DemoRole =
    role === 'COACH' || role === 'ATHLETE' || role === 'REFEREE' ? role : 'ORGANIZATION_HEAD';
  const ex = (k: string): string => t(`example.${r}.${k}`);
  const facts: ProfileFact[] = [
    { icon: 'building', label: r === 'REFEREE' ? t('categoryLabel') : t('club'), value: ex('club') },
    { icon: 'calendar', label: t('age'), value: ex('age') },
    ...(r === 'ATHLETE'
      ? [
          { icon: 'whistle' as const, label: t('coach'), value: ex('coach') },
          { icon: 'star' as const, label: t('rank'), value: ex('rank') },
        ]
      : []),
    { icon: 'pin', label: t('city'), value: ex('city') },
  ];
  const ribbon = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-800 shadow-sm theme-light">
      <Icon name="star" className="h-3.5 w-3.5" />
      {t('exampleRibbon')}
    </span>
  );
  return (
    <div className="mx-auto max-w-6xl">
      <ProfileView
        name={ex('name')}
        avatarUrl={null}
        roleLabel={tr(r)}
        facts={facts}
        athlete={r === 'ATHLETE' ? exampleAthleteStats() : undefined}
        ribbon={ribbon}
      >
        {r !== 'ATHLETE' ? (
          <ProfilePanel title={t('exampleWhatTitle')} icon="star" delay={120} className="xl:col-span-2">
            <p className="text-slate-700">{ex('what')}</p>
          </ProfilePanel>
        ) : null}
      </ProfileView>
      <p className="mt-4 text-center text-xs text-slate-500">{t('exampleNote')}</p>
      <DemoCta />
    </div>
  );
}
