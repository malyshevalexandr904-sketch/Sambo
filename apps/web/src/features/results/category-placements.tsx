'use client';
// Места под сеткой (план Phase 7b, §1): после последней подтверждённой схватки категории — места и медали
// (предварительные до публикации); идёт печать сетки — печатаются и места.
import { Card, CardTitle } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useCategoryResults } from './api';
import { PlacementsTable, ResultStatusBadge } from './shared';

export function CategoryPlacements({ categoryId }: { categoryId: string }) {
  const t = useTranslations('results');
  const query = useCategoryResults(categoryId);
  const data = query.data;
  if (!data || data.placements.length === 0 || !data.status) return null;
  return (
    <Card className="break-inside-avoid print:border-0 print:p-0 print:shadow-none">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CardTitle className="mb-0">{t('placesTitle')}</CardTitle>
        <ResultStatusBadge status={data.status} />
      </div>
      <PlacementsTable placements={data.placements} caption={t('placesTitle')} />
    </Card>
  );
}
