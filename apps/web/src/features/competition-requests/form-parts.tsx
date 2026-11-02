'use client';
// Части формы заявки на проведение турнира: выбор вариантом и автоматические списки минимальных требований
// (на ковёр — ноутбук и телевизор плюс Wi-Fi; на возрастную категорию на ковре — четыре судьи).
import type { HostingRequirements } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export const RADIO =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition';
export const radioTone = (on: boolean): string =>
  on
    ? 'border-blue-600 bg-blue-50 font-medium text-slate-900'
    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300';

export function Choice<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  label,
  error,
  columns = 3,
}: {
  name: string;
  legend: string;
  options: readonly T[];
  value: T | '';
  onChange: (v: T) => void;
  label: (v: T) => string;
  error?: string;
  columns?: 2 | 3;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className={cn('mt-2 grid gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((o) => (
          <label key={o} className={cn(RADIO, radioTone(value === o))}>
            <input
              type="radio"
              name={name}
              value={o}
              checked={value === o}
              onChange={() => onChange(o)}
              className="accent-blue-700"
            />
            <span>{label(o)}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Автоматический список минимальных требований под выбором «есть / частично / нет». */
function RequirementList({ title, items, note }: { title: string; items: ReactNode[]; note?: string }) {
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-800">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      {note ? <p className="mt-2 text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

export function EquipmentList({ req, mats }: { req: HostingRequirements; mats: number }) {
  const t = useTranslations('competitionRequests');
  return (
    <RequirementList
      title={t('equipmentListTitle', { mats })}
      items={[t('laptops', { n: req.laptops }), t('tvs', { n: req.tvs }), t('wifi')]}
    />
  );
}

export function RefereeList({
  req,
  mats,
  groups,
}: {
  req: HostingRequirements;
  mats: number;
  groups: number;
}) {
  const t = useTranslations('competitionRequests');
  return (
    <RequirementList
      title={t('refereeListTitle', { mats, groups: Math.max(1, groups) })}
      items={[
        t('matHeads', { n: req.matHeads }),
        t('arbiters', { n: req.arbiters }),
        t('sideJudges', { n: req.sideJudges }),
        t('timekeepers', { n: req.timekeepers }),
      ]}
    />
  );
}
