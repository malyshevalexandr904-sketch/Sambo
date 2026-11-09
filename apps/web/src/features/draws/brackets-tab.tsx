'use client';
// «Турнирные сетки» администратора (правки 09.11.2026, п. 3): после взвешивания — «Начать жеребьёвку»: система
// раскладывает допущенных спортсменов по сеткам и подгруппам (по Elo в рейтинговом формате) черновиками. Любую сетку
// можно открыть и вручную поменять спортсменов местами. В конце — «Опубликовать и перейти к проведению»: сетки
// публикуются в открытый доступ, по коврам строится и публикуется расписание, турнир переходит к соревнованиям —
// у руководителей ковров в личном кабинете появляется планшет ковра. Ниже — итоговые протоколы по категориям.
import type {
  CategoryDrawsDto,
  Competition,
  CompetitionCategoryDto,
  DataEnvelope,
  DrawDto,
  DrawOverviewRow,
  ScheduleDto,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCategories } from '@/features/competitions/categories';
import { NextStageButton, useTransition } from '@/features/competitions/next-stage';
import { ResultsTab } from '@/features/results/results-tab';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { DrawsTab } from './draws-tab';
import { useCommandError, useDrawOverview } from './shared';

const NEEDS_READY = new Set(['CLOSED', 'WEIGH_IN']);
const LIVE = new Set(['SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'ARCHIVED']);

const active = (r: DrawOverviewRow): boolean =>
  r.admitted > 0 && r.category.status !== 'CANCELLED' && r.category.status !== 'MERGED';

export function BracketsTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations('brackets');
  if (['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'].includes(c.status))
    return (
      <div className="space-y-4">
        <Alert tone="info">{t('notYet')}</Alert>
        {c.status === 'CHECK_IN' ? (
          <NextStageButton competition={c} to="DRAWING" label={t('finishWeighIn')} />
        ) : null}
      </div>
    );
  return (
    <div className="space-y-6">
      <DrawsTab
        competition={c}
        tabKey="brackets"
        top={c.status === 'DRAWING' ? <DrawControlCard competition={c} /> : null}
      />
      {LIVE.has(c.status) ? (
        <section aria-labelledby="brackets-protocols">
          <h2 id="brackets-protocols" className="mb-3 text-lg font-semibold">
            {t('protocols')}
          </h2>
          <ResultsTab competition={c} />
        </section>
      ) : null}
    </div>
  );
}

interface Progress {
  done: number;
  total: number;
  name: string;
}

function DrawControlCard({ competition: c }: { competition: Competition }) {
  const t = useTranslations('brackets');
  const locale = useLocale();
  const describe = useCommandError();
  const queryClient = useQueryClient();
  const overview = useDrawOverview(c.id);
  const categories = useCategories(c.id);
  const transition = useTransition(c);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const rows = (overview.data ?? []).filter(active);
  const toDraw = rows.filter((r) => !r.published && r.drafts === 0);
  const toPublish = rows.filter((r) => !r.published && r.drafts > 0);
  const published = rows.filter((r) => r.published).length;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['competitions', c.id] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['draws'] }),
    ]);
  const each = async (
    list: DrawOverviewRow[],
    fn: (r: DrawOverviewRow) => Promise<void>,
  ): Promise<number> => {
    const errors: { name: string; error: string }[] = [];
    let ok = 0;
    for (const [i, r] of list.entries()) {
      const name = pickName(r.category.name, locale);
      setProgress({ done: i, total: list.length, name });
      try {
        await fn(r);
        ok += 1;
      } catch (e) {
        errors.push({ name, error: describe(e) });
      }
    }
    setProgress(null);
    setFailed(errors);
    await refresh();
    return ok;
  };

  /** «Начать жеребьёвку»: категории — в «Готова к жеребьёвке», по каждой — черновик сетки (без публикации). */
  const start = async (): Promise<void> => {
    setMessage(null);
    const byId = new Map((categories.data ?? []).map((x) => [x.id, x]));
    const ok = await each(toDraw, async (row) => {
      const category: CompetitionCategoryDto | undefined = byId.get(row.category.id);
      if (NEEDS_READY.has(row.category.status) && category)
        await api(`/competitions/${c.id}/categories/${row.category.id}/transitions`, {
          method: 'POST',
          body: { to: 'READY_FOR_DRAW' },
          version: category.version,
        });
      const rated = row.suggestedFormat === 'SPECIAL_GROUP_RATED';
      await api<DataEnvelope<DrawDto>>(`/categories/${row.category.id}/draws`, {
        method: 'POST',
        body: { seeding: [], separation: { by: rated ? [] : ['ORGANIZATION', 'REGION'] } },
      });
    });
    setMessage(t('drafted', { count: ok }));
  };

  /** «Опубликовать и перейти к проведению»: последние черновики, расписание по коврам, стадия «Идёт». */
  const publishAll = async (): Promise<void> => {
    setMessage(null);
    await each(toPublish, async (row) => {
      const data = (await api<DataEnvelope<CategoryDrawsDto>>(`/categories/${row.category.id}/draws`)).data;
      const draft = [...data.draws]
        .filter((d) => d.status === 'DRAFT')
        .sort((a, b) => b.number - a.number)[0];
      if (!draft) return;
      await api(`/draws/${draft.id}/publish`, { method: 'POST', body: {}, version: draft.version });
    });
    try {
      setProgress({ done: 0, total: 1, name: t('scheduleStep') });
      const schedule = await api<DataEnvelope<ScheduleDto>>(`/competitions/${c.id}/schedule/generate`, {
        method: 'POST',
        body: { categoryPins: [], finalsBlock: false },
      });
      await api(`/competitions/${c.id}/schedule/publish`, {
        method: 'POST',
        body: {},
        version: schedule.data.version,
      });
    } catch (e) {
      setProgress(null);
      setFailed((f) => [...f, { name: t('scheduleStep'), error: describe(e) }]);
      await refresh();
      return;
    }
    setProgress(null);
    if (await transition.go('SCHEDULED')) await transition.go('IN_PROGRESS');
    await refresh();
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
      <p className="mb-3 text-sm text-slate-700">
        {t('status', { drafts: toPublish.length, published, total: rows.length })}
      </p>
      {progress ? (
        <div role="status" aria-live="polite" className="mb-3">
          <p className="text-sm">{t('progress', { ...progress })}</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-blue-700 transition-all"
              style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
      {message ? (
        <Alert tone="success" className="mb-3">
          {message}
        </Alert>
      ) : null}
      {failed.length > 0 ? (
        <Alert tone="warning" title={t('failedTitle', { count: failed.length })} className="mb-3">
          <ul className="list-disc pl-5">
            {failed.map((f) => (
              <li key={f.name}>
                {f.name}: {f.error}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {transition.error ? (
        <Alert tone="danger" className="mb-3">
          {transition.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          loading={!!progress}
          disabled={toDraw.length === 0 || overview.isPending || categories.isPending}
          variant={toPublish.length > 0 ? 'secondary' : 'primary'}
          onClick={() => void start()}
        >
          {toDraw.length === 0 ? t('startNothing') : t('start', { count: toDraw.length })}
        </Button>
        <Button
          loading={!!progress || transition.busy}
          disabled={toPublish.length === 0 && published === 0}
          onClick={() => {
            if (window.confirm(t('publishConfirm'))) void publishAll();
          }}
        >
          {t('publish')}
        </Button>
      </div>
    </Card>
  );
}
