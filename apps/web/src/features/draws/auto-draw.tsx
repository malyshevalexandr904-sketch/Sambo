'use client';
// Автожеребьёвка (правки 05.11.2026): одной кнопкой все категории без опубликованной жеребьёвки переводятся
// в «Готова к жеребьёвке», разыгрываются с форматом по правилам турнира (разведение по команде и региону) и
// публикуются; затем — черновик расписания по коврам. Каждая категория — теми же командами, что вручную, поэтому
// условия проверяет сервер, а сбой одной категории не мешает остальным.
import type {
  Competition,
  CompetitionCategoryDto,
  DataEnvelope,
  DrawDto,
  DrawOverviewRow,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCategories } from '@/features/competitions/categories';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useCommandError, useDrawOverview } from './shared';

const NEEDS_READY = new Set(['CLOSED', 'WEIGH_IN']);

interface Report {
  done: string[];
  failed: { name: string; error: string }[];
  schedule: 'created' | 'failed' | 'skipped';
  scheduleError?: string;
}

export function AutoDrawCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('draws.auto');
  const locale = useLocale();
  const pathname = usePathname();
  const describe = useCommandError();
  const queryClient = useQueryClient();
  const overview = useDrawOverview(c.id);
  const categories = useCategories(c.id);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const pending = (overview.data ?? []).filter(
    (r) =>
      !r.published && r.admitted > 0 && r.category.status !== 'CANCELLED' && r.category.status !== 'MERGED',
  );

  const drawOne = async (
    row: DrawOverviewRow,
    category: CompetitionCategoryDto | undefined,
  ): Promise<void> => {
    if (NEEDS_READY.has(row.category.status) && category) {
      await api(`/competitions/${c.id}/categories/${row.category.id}/transitions`, {
        method: 'POST',
        body: { to: 'READY_FOR_DRAW' },
        version: category.version,
      });
    }
    const rated = row.suggestedFormat === 'SPECIAL_GROUP_RATED';
    const draw = await api<DataEnvelope<DrawDto>>(`/categories/${row.category.id}/draws`, {
      method: 'POST',
      body: { seeding: [], separation: { by: rated ? [] : ['ORGANIZATION', 'REGION'] } },
    });
    await api(`/draws/${draw.data.id}/publish`, { method: 'POST', body: {}, version: draw.data.version });
  };

  const run = async (): Promise<void> => {
    const rows = pending;
    const byId = new Map((categories.data ?? []).map((x) => [x.id, x]));
    const result: Report = { done: [], failed: [], schedule: 'skipped' };
    for (const [i, row] of rows.entries()) {
      const name = pickName(row.category.name, locale);
      setProgress({ done: i, total: rows.length, name });
      try {
        await drawOne(row, byId.get(row.category.id));
        result.done.push(name);
      } catch (e) {
        result.failed.push({ name, error: describe(e) });
      }
    }
    // Категории по коврам: черновик расписания (проверить и опубликовать — во вкладке «Расписание»).
    if (result.done.length > 0 && c.allowedActions.includes('schedule.manage')) {
      setProgress({ done: rows.length, total: rows.length, name: t('scheduleStep') });
      try {
        await api(`/competitions/${c.id}/schedule/generate`, {
          method: 'POST',
          body: { categoryPins: [], finalsBlock: false },
        });
        result.schedule = 'created';
      } catch (e) {
        result.schedule = 'failed';
        result.scheduleError = describe(e);
      }
    }
    setProgress(null);
    setReport(result);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['competitions', c.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['draws'] }),
    ]);
  };

  if (!c.allowedActions.includes('draw.create')) return null;
  return (
    <Card className="print:hidden">
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-3 text-sm text-slate-600">{t('hint')}</p>
      <ol className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
        {(['step1', 'step2', 'step3'] as const).map((s, i) => (
          <li key={s} className="flex gap-2 rounded-md bg-slate-50 p-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-700 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            {t(s)}
          </li>
        ))}
      </ol>
      {progress ? (
        <div role="status" aria-live="polite" className="mb-3">
          <p className="text-sm">{t('progress', progress)}</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-blue-700 transition-all"
              style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
      {report ? (
        <div className="mb-3 space-y-2">
          {report.done.length > 0 ? (
            <Alert tone="success">{t('doneCount', { count: report.done.length })}</Alert>
          ) : null}
          {report.failed.length > 0 ? (
            <Alert tone="warning" title={t('failedTitle', { count: report.failed.length })}>
              <ul className="list-disc pl-5">
                {report.failed.map((f) => (
                  <li key={f.name}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {report.schedule === 'created' ? (
            <Alert tone="info">
              {t('scheduleCreated')}{' '}
              <Link href={{ pathname, query: { tab: 'schedule' } }} className="font-medium underline">
                {t('openSchedule')}
              </Link>
            </Alert>
          ) : null}
          {report.schedule === 'failed' ? (
            <Alert tone="warning">{t('scheduleFailed', { error: report.scheduleError ?? '' })}</Alert>
          ) : null}
        </div>
      ) : null}
      <Button
        loading={!!progress}
        disabled={pending.length === 0 || overview.isPending || categories.isPending}
        onClick={() => {
          if (window.confirm(t('confirm', { count: pending.length }))) void run();
        }}
      >
        {pending.length === 0 ? t('nothing') : t('button', { count: pending.length })}
      </Button>
    </Card>
  );
}
