'use client';
// Значок готовности документов спортсмена (правки 09.11.2026, п. 3): зелёный — всё в порядке, красный — документы не
// загружены (не пройдёт комиссию по допуску), оранжевый — срок действия документа истёк, синий — ждут проверки.
import type { DocumentReadinessDto } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';

const TONE: Record<DocumentReadinessDto['state'], string> = {
  OK: 'bg-green-100 text-green-900 ring-green-300',
  MISSING: 'bg-red-100 text-red-900 ring-red-300',
  EXPIRED: 'bg-orange-100 text-orange-900 ring-orange-300',
  PENDING: 'bg-blue-50 text-blue-900 ring-blue-300',
};

const DOT: Record<DocumentReadinessDto['state'], string> = {
  OK: 'bg-green-600',
  MISSING: 'bg-red-600',
  EXPIRED: 'bg-orange-500',
  PENDING: 'bg-blue-600',
};

export function DocBadge({
  documents,
  detailed = false,
}: {
  documents: DocumentReadinessDto;
  detailed?: boolean;
}) {
  const t = useTranslations('roster.docs');
  const td = useTranslations('roster.docTypes');
  const types = [...documents.missing, ...documents.expired, ...documents.pending];
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
          TONE[documents.state],
        )}
      >
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', DOT[documents.state])} />
        {t(documents.state)}
      </span>
      {detailed && types.length > 0 ? (
        <span className="text-xs text-slate-600">
          {[
            ...documents.missing.map((x) => t('missingType', { type: td.has(x) ? td(x) : x })),
            ...documents.expired.map((x) => t('expiredType', { type: td.has(x) ? td(x) : x })),
            ...documents.pending.map((x) => t('pendingType', { type: td.has(x) ? td(x) : x })),
          ].join('; ')}
        </span>
      ) : null}
    </span>
  );
}
