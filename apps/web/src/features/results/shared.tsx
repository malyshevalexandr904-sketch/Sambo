'use client';
// Итоги: медали, статус итогов категории, таблица мест (подходит и для телефона: клуб — под именем).
import type { CategoryResultStatus, Medal, PlacementDto } from '@sde/contracts';
import { Badge, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';

const MEDAL_STYLE: Record<Medal, string> = {
  GOLD: 'bg-amber-100 text-amber-900 ring-amber-400',
  SILVER: 'bg-slate-100 text-slate-800 ring-slate-400',
  BRONZE: 'bg-orange-100 text-orange-900 ring-orange-400',
};
const MEDAL_ICON: Record<Medal, string> = { GOLD: '①', SILVER: '②', BRONZE: '③' };

/** Медаль: цвет продублирован текстом и значком (не только цвет). */
export function MedalBadge({ medal, className }: { medal: Medal; className?: string }) {
  const t = useTranslations('results.medals');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        MEDAL_STYLE[medal],
        className,
      )}
    >
      <span aria-hidden="true">{MEDAL_ICON[medal]}</span>
      {t(medal)}
    </span>
  );
}

const STATUS_TONE: Record<CategoryResultStatus, 'info' | 'success' | 'warning'> = {
  PROVISIONAL: 'info',
  PUBLISHED: 'success',
  AMENDED: 'warning',
};
const STATUS_ICON: Record<CategoryResultStatus, string> = { PROVISIONAL: '◆', PUBLISHED: '●', AMENDED: '◐' };

export function ResultStatusBadge({ status }: { status: CategoryResultStatus }) {
  const t = useTranslations('results.statuses');
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      {t(status)}
    </Badge>
  );
}

/** Таблица мест категории: место, спортсмен (клуб и регион — второй строкой), победы и поражения, медаль. */
export function PlacementsTable({ placements, caption }: { placements: PlacementDto[]; caption?: string }) {
  const t = useTranslations('results');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <th scope="col" className="w-10 px-1 py-2 text-center sm:w-12 sm:px-2">
              {t('place')}
            </th>
            <th scope="col" className="px-2 py-2">
              {t('athlete')}
            </th>
            <th scope="col" className="w-14 whitespace-nowrap px-2 py-2 text-center">
              <abbr title={t('winsLossesHint')}>{t('winsLosses')}</abbr>
            </th>
            <th scope="col" className="hidden w-28 px-2 py-2 text-center sm:table-cell">
              {t('medal')}
            </th>
          </tr>
        </thead>
        <tbody>
          {placements.map((p) => (
            <tr key={p.entryId} className="border-b border-slate-100 last:border-0">
              <td className="px-1 py-2 text-center text-lg font-bold tabular-nums sm:px-2">{p.place}</td>
              <td className="min-w-0 px-2 py-2">
                <span className="font-medium">{p.publicName}</span>
                {p.withdrawn ? (
                  <Badge tone="warning" className="ml-2">
                    {t('withdrawn')}
                  </Badge>
                ) : null}
                <span className="block text-xs text-slate-500">
                  {[p.club, p.region].filter(Boolean).join(', ')}
                </span>
                {p.medal ? <MedalBadge medal={p.medal} className="mt-1 sm:hidden" /> : null}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums">
                {p.wins}–{p.losses}
              </td>
              <td className="hidden px-2 py-2 text-center sm:table-cell">
                {p.medal ? <MedalBadge medal={p.medal} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
