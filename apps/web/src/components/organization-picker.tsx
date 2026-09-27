'use client';
// Выбор организации для действия: свои организации — списком; платформенной роли — поиск по названию
// (организаций может быть больше, чем помещается в список).
import type { OrganizationSummary, OrganizationType, PermissionCode } from '@sde/contracts';
import { Field, Input, Select } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useOrganizationsWith } from '@/lib/use-orgs';

export function OrganizationPicker({
  id,
  label,
  permission,
  types,
  value,
  onChange,
  className,
  error,
}: {
  id: string;
  label: string;
  permission: PermissionCode;
  types?: readonly OrganizationType[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  error?: string;
}) {
  const t = useTranslations('common');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const orgs = useOrganizationsWith(permission, types, q);
  const [chosen, setChosen] = useState<OrganizationSummary | null>(null);
  const first = orgs.data[0];
  useEffect(() => {
    if (!value && first) {
      setChosen(first);
      onChange(first.id);
    }
  }, [value, first, onChange]);
  const options = chosen && !orgs.data.some((o) => o.id === chosen.id) ? [chosen, ...orgs.data] : orgs.data;
  return (
    <div className={className}>
      {orgs.searchable ? (
        <Field id={`${id}-search`} label={t('searchOrganization')} className="mb-2">
          <Input
            id={`${id}-search`}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
          />
        </Field>
      ) : null}
      <Field id={id} label={label} error={error}>
        <Select
          id={id}
          value={value}
          onChange={(e) => {
            setChosen(options.find((o) => o.id === e.target.value) ?? null);
            onChange(e.target.value);
          }}
        >
          {options.length === 0 ? (
            <option value="">{orgs.isPending ? t('loading') : t('noData')}</option>
          ) : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
