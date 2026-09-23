// Правила организаций: статусы, членства, роль создателя, slug (DATABASE.md, 3.2; API.md, 3.4).
import type { MembershipStatus, OrganizationStatus, OrganizationType, RoleCode } from '@sde/contracts';

interface Transition<S extends string> {
  from: S;
  to: S;
  reasonRequired: boolean;
}

export const ORGANIZATION_TRANSITIONS: Transition<OrganizationStatus>[] = [
  { from: 'PENDING_REVIEW', to: 'ACTIVE', reasonRequired: false },
  { from: 'PENDING_REVIEW', to: 'ARCHIVED', reasonRequired: true },
  { from: 'ACTIVE', to: 'SUSPENDED', reasonRequired: true },
  { from: 'SUSPENDED', to: 'ACTIVE', reasonRequired: false },
  { from: 'ACTIVE', to: 'ARCHIVED', reasonRequired: true },
  { from: 'SUSPENDED', to: 'ARCHIVED', reasonRequired: true },
];

export const MEMBERSHIP_TRANSITIONS: Transition<MembershipStatus>[] = [
  { from: 'INVITED', to: 'ENDED', reasonRequired: false },
  { from: 'ACTIVE', to: 'SUSPENDED', reasonRequired: false },
  { from: 'ACTIVE', to: 'ENDED', reasonRequired: false },
  { from: 'SUSPENDED', to: 'ACTIVE', reasonRequired: false },
  { from: 'SUSPENDED', to: 'ENDED', reasonRequired: false },
];

export type TransitionCheck<S extends string> =
  | { ok: true; reasonRequired: boolean }
  | { ok: false; allowed: S[] };

export function checkTransition<S extends string>(table: Transition<S>[], from: S, to: S): TransitionCheck<S> {
  const found = table.find((t) => t.from === from && t.to === to);
  if (found) return { ok: true, reasonRequired: found.reasonRequired };
  return { ok: false, allowed: table.filter((t) => t.from === from).map((t) => t.to) };
}

/** Роль, которую получает создатель организации (API.md, 3.4). */
export function creatorRole(type: OrganizationType): RoleCode {
  switch (type) {
    case 'NATIONAL_FEDERATION':
    case 'REGIONAL_FEDERATION':
      return 'FEDERATION_ADMIN';
    case 'ORGANIZER':
      return 'ORGANIZER';
    case 'CLUB':
    case 'SPORTS_SCHOOL':
    case 'OTHER':
      return 'CLUB_MANAGER';
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', '№': '',
};

/** Slug из названия: транслитерация, латиница, цифры и дефисы, 3–80 символов. */
export function slugify(value: string): string {
  const latin = [...value.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('');
  const slug = latin
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `org-${slug}`.padEnd(3, '0');
}
