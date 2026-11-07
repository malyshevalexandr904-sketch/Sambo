// Единые требования допуска (правки 07.11.2026, п. 13): пять документов из «Моих документов», одинаковые для всех
// турниров платформы. Показываются в положении турнира, на его публичной странице и в кабинете.
import { ADMISSION_DOCUMENT_SLOTS } from '@sde/contracts';
import { useTranslations } from 'next-intl';

export function UnifiedRequirementsList({ className }: { className?: string }) {
  const t = useTranslations('admissionDocs');
  return (
    <div className={className}>
      <p className="text-sm text-slate-600">{t('intro')}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800">
        {ADMISSION_DOCUMENT_SLOTS.map((k) => (
          <li key={k}>{t(`items.${k}`)}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-slate-500">{t('outro')}</p>
    </div>
  );
}
