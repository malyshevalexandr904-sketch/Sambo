'use client';
// Очередь документов на проверку (API.md, 4.6): секретарь турнира и клуб видят документы в своей области.
import { DOCUMENT_STATUSES, type DocumentDto, type Page } from '@sde/contracts';
import { Button, EmptyState, PageHeader, Select } from '@sde/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { pickName, qk, useDocumentTypes } from '@/lib/queries';
import { DocumentItem } from './shared';

export function DocumentsQueue() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const types = useDocumentTypes();
  const [filters, setFilters] = useState({ status: 'UPLOADED', typeCode: '' });
  const query = useInfiniteQuery({
    queryKey: qk.documents({ queue: true, ...filters }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<DocumentDto>>('/documents', { query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('documents.queueTitle')} description={t('documents.queueHint')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:w-2/3">
        <Select
          aria-label={t('common.status')}
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">{t('common.all')}</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`documents.statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('documents.type')}
          value={filters.typeCode}
          onChange={(e) => setFilters({ ...filters, typeCode: e.target.value })}
        >
          <option value="">
            {t('documents.type')}: {t('common.all')}
          </option>
          {(types.data ?? []).map((x) => (
            <option key={x.code} value={x.code}>
              {pickName(x.name, locale)}
            </option>
          ))}
        </Select>
      </div>
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('common.noData')}>{t('documents.queueEmpty')}</EmptyState>
          ) : (
            <>
              <ul className="space-y-2">
                {rows.map((d) => (
                  <DocumentItem
                    key={d.id}
                    doc={d}
                    showOwner
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ['documents'] })}
                  />
                ))}
              </ul>
              {query.hasNextPage ? (
                <Button
                  variant="secondary"
                  className="mt-4"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </>
  );
}
