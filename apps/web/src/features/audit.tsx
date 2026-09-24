'use client';
// Журнал аудита платформы (API.md, 3.6; ARCHITECTURE.md, 11).
import type { AuditEntry, Page } from '@sde/contracts';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th } from '@sde/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';

function Changes({ entry }: { entry: AuditEntry }) {
  const t = useTranslations('audit');
  const keys = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])];
  if (keys.length === 0) return <span className="text-slate-400">—</span>;
  const show = (v: unknown): string =>
    v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return (
    <details>
      <summary className="cursor-pointer text-blue-700">{keys.length}</summary>
      <table className="mt-2 text-xs">
        <thead>
          <tr>
            <th className="pr-2 text-left" />
            <th className="pr-2 text-left">{t('before')}</th>
            <th className="text-left">{t('after')}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="pr-2 font-mono">{k}</td>
              <td className="max-w-48 break-all pr-2">{show(entry.before?.[k])}</td>
              <td className="max-w-48 break-all">{show(entry.after?.[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AuditLog() {
  const t = useTranslations('audit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [draft, setDraft] = useState({ action: '', entityType: '' });
  const [filters, setFilters] = useState(draft);
  const query = useInfiniteQuery({
    queryKey: qk.audit(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AuditEntry>>('/admin/audit-logs', { query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('title')} />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <Input
          aria-label={t('filterAction')}
          placeholder={t('filterAction')}
          value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value })}
        />
        <Input
          aria-label={t('filterEntityType')}
          placeholder={t('filterEntityType')}
          value={draft.entityType}
          onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
        />
        <Button type="submit">{tc('apply')}</Button>
      </form>
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={tc('noData')} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('occurredAt')}</Th>
                    <Th>{t('actor')}</Th>
                    <Th>{t('action')}</Th>
                    <Th>{t('entity')}</Th>
                    <Th>{t('changes')}</Th>
                    <Th>{tc('reason')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(r.occurredAt, locale)}</Td>
                      <Td>
                        {r.actor.displayName ?? t('system')}
                        <div className="text-xs text-slate-500">{r.ipMasked ?? ''}</div>
                      </Td>
                      <Td>
                        <code className="text-xs">{r.action}</code>
                        {r.platformIntervention ? (
                          <Badge tone="warning">{t('platformIntervention')}</Badge>
                        ) : null}
                      </Td>
                      <Td>
                        {r.entityType}
                        <div className="font-mono text-xs text-slate-500">
                          {r.entityId?.slice(0, 8) ?? ''}
                        </div>
                      </Td>
                      <Td>
                        <Changes entry={r} />
                      </Td>
                      <Td className="max-w-64">{r.reason ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {query.hasNextPage ? (
                <Button
                  variant="secondary"
                  className="mt-4"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {tc('loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </>
  );
}
