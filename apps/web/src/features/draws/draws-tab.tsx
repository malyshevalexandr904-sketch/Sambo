'use client';
// Вкладка «Жеребьёвка» (экран главного секретаря, IMPLEMENTATION_PLAN, Phase 5): категории турнира с готовностью
// к жеребьёвке и опубликованными версиями; выбранная категория — черновик, предпросмотр, публикация.
import type { CategoryDrawsDto, Competition } from '@sde/contracts';
import { Alert, Badge, Button, Card, EmptyState } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { QueryState } from '@/components/common';
import { CategoryStatusBadge } from '@/features/competitions/shared';
import { usePathname, useRouter } from '@/i18n/navigation';
import { pickName } from '@/lib/queries';
import { CategoryDraws } from './category-draws';
import { DrawStatusBadge, useCategoryDraws, useDrawOverview, useFormatLabel } from './shared';

const DRAW_PHASE = ['DRAWING', 'SCHEDULED', 'IN_PROGRESS'];

function Overview({
  competition,
  onOpen,
}: {
  competition: Competition;
  onOpen: (categoryId: string) => void;
}) {
  const t = useTranslations('draws');
  const locale = useLocale();
  const formatLabel = useFormatLabel();
  const overview = useDrawOverview(competition.id);
  return (
    <QueryState isPending={overview.isPending} error={overview.error}>
      {() => {
        const rows = overview.data ?? [];
        if (rows.length === 0) return <EmptyState title={t('noCategories')} />;
        const drawn = rows.filter((r) => r.published).length;
        return (
          <>
            <p className="mb-3 text-sm text-slate-700">{t('progress', { drawn, total: rows.length })}</p>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.category.id}>
                  <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{pickName(r.category.name, locale)}</p>
                      <p className="text-sm text-slate-600">
                        {t('admittedCount', { admitted: r.admitted })}
                        {r.admissionPending > 0
                          ? ` · ${t('pendingCount', { pending: r.admissionPending })}`
                          : ''}
                        {r.published || r.suggestedFormat
                          ? ` · ${formatLabel(r.published?.format ?? r.suggestedFormat)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CategoryStatusBadge status={r.category.status} />
                      {r.published ? (
                        <span className="flex items-center gap-1 text-sm">
                          <DrawStatusBadge status="PUBLISHED" />
                          {t('version', { number: r.published.number })}
                        </span>
                      ) : r.drafts > 0 ? (
                        <Badge tone="info">{t('drafts', { count: r.drafts })}</Badge>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => onOpen(r.category.id)}>
                        {t('open')}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </QueryState>
  );
}

function CategoryPanel({
  competition,
  categoryId,
  drawId,
  onSelectDraw,
}: {
  competition: Competition;
  categoryId: string;
  drawId: string | null;
  onSelectDraw: (id: string) => void;
}) {
  const query = useCategoryDraws(categoryId);
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => (
        <CategoryDraws
          competition={competition}
          data={query.data as CategoryDrawsDto}
          drawId={drawId}
          onSelectDraw={onSelectDraw}
        />
      )}
    </QueryState>
  );
}

export function DrawsTab({ competition }: { competition: Competition }) {
  const t = useTranslations('draws');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const categoryId = params.get('category');
  const drawId = params.get('draw');
  const go = (query: Record<string, string>): void =>
    router.replace({ pathname, query: { tab: 'draws', ...query } }, { scroll: false });
  return (
    <div className="space-y-4">
      {!DRAW_PHASE.includes(competition.status) ? (
        <Alert tone="info" className="print:hidden">
          {t('notDrawingStage')}
        </Alert>
      ) : null}
      {categoryId ? (
        <>
          <Button variant="ghost" className="print:hidden" onClick={() => go({})}>
            ← {t('back')}
          </Button>
          <CategoryPanel
            competition={competition}
            categoryId={categoryId}
            drawId={drawId}
            onSelectDraw={(id) => go({ category: categoryId, draw: id })}
          />
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">{t('hint')}</p>
          <Overview competition={competition} onOpen={(id) => go({ category: id })} />
        </>
      )}
    </div>
  );
}
