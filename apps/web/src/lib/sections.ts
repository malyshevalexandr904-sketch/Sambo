// Разделы роли внутри вкладок (правки 05.11.2026, п. 4): блока «Работа» в личном кабинете больше нет — каждая его
// ссылка живёт во вкладке, к которой относится по смыслу. Турнирное (заявки, судейство, наборы, судьи) — во
// «Турнирах», работа со спортсменами (проверка анкет и документов, дети) — в «Моих спортсменах», справочники
// турниров (категории, правила) — в «Настройках». Если у роли нет «Моих спортсменов», их ссылки показываются во
// «Турнирах», чтобы ничего не потерялось. Видимость — по тем же правам, что были у «Работы»; скрытие — удобство,
// не защита (права проверяет сервер).
import type { Me, MyAthlete } from '@sde/contracts';
import { hasAnywhere } from './access';

export type SectionHost = 'competitions' | 'athletes' | 'settings';

export interface SectionLink {
  href: string;
  /** Ключ подписи в `sections.links`. */
  key: string;
  host: SectionHost;
}

/** Есть ли у роли вкладка «Мои спортсмены» (или «Мои тренеры» — у руководителя есть обе). */
export function hasAthletesTab(me: Me): boolean {
  return me.activeRole === 'ORGANIZATION_HEAD' || me.activeRole === 'COACH';
}

export function sectionLinks(me: Me, myAthletes: MyAthlete[] | undefined): SectionLink[] {
  const athletesHost: SectionHost = hasAthletesTab(me) ? 'athletes' : 'competitions';
  const all: (SectionLink & { visible: boolean })[] = [
    {
      href: '/competition-requests',
      key: 'competitionRequests',
      host: 'competitions',
      visible: hasAnywhere(me, 'competition.request'),
    },
    {
      href: '/applications',
      key: 'applications',
      host: 'competitions',
      visible: hasAnywhere(me, 'registration.create'),
    },
    {
      href: '/referee',
      key: 'referee',
      host: 'competitions',
      visible:
        me.activeRole === 'REFEREE' || me.grants.competitions.length > 0 || hasAnywhere(me, 'result.confirm'),
    },
    {
      href: '/referee/recruitment',
      key: 'recruitment',
      host: 'competitions',
      visible: me.activeRole === 'REFEREE',
    },
    {
      href: '/admin/referees',
      key: 'referees',
      host: 'competitions',
      visible: me.activeRole !== 'ADMIN' && hasAnywhere(me, 'referee.manage'),
    },
    {
      href: '/onboarding/review',
      key: 'review',
      host: athletesHost,
      // У администратора платформы «Проверка заявок» уже есть в меню.
      visible:
        me.activeRole !== 'ADMIN' &&
        (hasAnywhere(me, 'onboarding.review') ||
          me.grants.organizations.some((g) => g.roles.includes('COACH'))),
    },
    {
      href: '/documents',
      key: 'documents',
      host: athletesHost,
      visible: me.activeRole !== 'REFEREE' && hasAnywhere(me, 'document.verify'),
    },
    {
      href: '/children',
      key: 'children',
      host: athletesHost,
      // У представителя «Мои спортсмены» (дети) — отдельная вкладка меню.
      visible: me.activeRole !== 'ATHLETE' && me.activeRole !== 'GUARDIAN' && (myAthletes?.length ?? 0) > 0,
    },
    {
      href: '/athletes',
      key: 'athletes',
      host: 'competitions',
      // Права на спортсменов без вкладки «Мои спортсмены» (например, судья — сотрудник клуба).
      visible: !hasAthletesTab(me) && me.activeRole !== 'ADMIN' && hasAnywhere(me, 'athlete.view'),
    },
    {
      href: '/admin/categories',
      key: 'categories',
      host: 'settings',
      visible: hasAnywhere(me, 'category.manage'),
    },
    {
      href: '/admin/rulesets',
      key: 'rulesets',
      host: 'settings',
      visible: hasAnywhere(me, 'ruleset.manage'),
    },
  ];
  return all.filter((l) => l.visible).map(({ href, key, host }) => ({ href, key, host }));
}

/**
 * К какой вкладке меню относится адрес (подсветка пункта меню, когда открыт раздел из вкладки): например,
 * «Судейство» — это «Турниры».
 */
export function hostTabOf(me: Me, pathname: string): string | null {
  const is = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  const athletes = hasAthletesTab(me) ? '/athletes' : '/competitions';
  if (is('/competition-requests') || is('/applications') || is('/referee') || is('/admin/referees'))
    return me.activeRole === 'ADMIN' && is('/competition-requests') ? null : '/competitions';
  if (is('/onboarding/review') || is('/documents')) return me.activeRole === 'ADMIN' ? null : athletes;
  if (is('/children')) return me.activeRole === 'GUARDIAN' ? '/children' : athletes;
  if (is('/admin/categories') || is('/admin/rulesets') || is('/admin/organizations/new'))
    return me.activeRole === 'ADMIN' ? null : '/settings';
  return null;
}
