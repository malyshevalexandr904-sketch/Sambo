'use client';
// Выбор владельца справочной записи: шаблон платформы или организация (федерация, организатор).
import type { PermissionCode } from '@sde/contracts';
import { Select } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { platformHas } from '@/lib/access';
import { pickName, useDisciplines, useMe } from '@/lib/queries';
import { useOrganizationsWith } from '@/lib/use-orgs';

export function useOwners(permission: PermissionCode): { id: string; label: string }[] {
  const t = useTranslations('catalog');
  const { data: me } = useMe();
  const orgs = useOrganizationsWith(permission);
  return [
    ...(platformHas(me, permission) ? [{ id: 'platform', label: t('platform') }] : []),
    ...orgs.data.map((o) => ({ id: o.id, label: o.shortName })),
  ];
}

export function OwnerAndDiscipline({
  permission,
  owner,
  discipline,
  onChange,
}: {
  permission: PermissionCode;
  owner: string;
  discipline: string;
  onChange: (v: { owner: string; discipline: string }) => void;
}) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const owners = useOwners(permission);
  const disciplines = useDisciplines();
  useEffect(() => {
    if (!owner && owners[0]) onChange({ owner: owners[0].id, discipline });
  }, [owner, owners, discipline, onChange]);
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:w-2/3">
      <Select
        aria-label={t('owner')}
        value={owner}
        onChange={(e) => onChange({ owner: e.target.value, discipline })}
      >
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {t('owner')}: {o.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('discipline')}
        value={discipline}
        onChange={(e) => onChange({ owner, discipline: e.target.value })}
      >
        {(disciplines.data ?? []).map((d) => (
          <option key={d.code} value={d.code}>
            {pickName(d.name, locale)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Тело запроса: владелец-организация передаётся явно, шаблон платформы — без поля. */
export const ownerBody = (owner: string): { ownerOrganizationId?: string } =>
  owner && owner !== 'platform' ? { ownerOrganizationId: owner } : {};
