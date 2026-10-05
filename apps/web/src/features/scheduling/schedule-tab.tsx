'use client';
// Вкладка «Расписание» (план Phase 6, §2–§4, §6): генерация автопланировщиком, доска по сессиям и коврам,
// ручная правка пакетом (запреты — отказ, предупреждения — подтверждение), публикация, печать A4.
import type { Competition, MatDto, ScheduleDto, ScheduleMatchDto, ScheduleSessionDto } from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, EmptyState } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { MatsSessionsPanel } from './mats-sessions';
import { MoveMatchForm } from './move-match-form';
import { timeInZone, useInvalidateScheduling, useMats, useSchedule, useSessions } from './shared';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  SCHEDULED: 'info',
  READY: 'info',
  IN_PROGRESS: 'success',
  PAUSED: 'warning',
  FINISHED: 'neutral',
  POSTPONED: 'warning',
  CANCELLED: 'danger',
};

function MatchStatusBadge({ status }: { status: string }) {
  const t = useTranslations('scheduling.matchStatuses');
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{t.has(status) ? t(status) : status}</Badge>;
}

function GenerateAction({ competition, onDone }: { competition: Competition; onDone: () => Promise<void> }) {
  const t = useTranslations('scheduling.generate');
  const [open, setOpen] = useState(false);
  const [finalsBlock, setFinalsBlock] = useState(true);
  const action = useAction();
  if (!open) return <Button onClick={() => setOpen(true)}>{t('action')}</Button>;
  return (
    <div className="w-full rounded-md border border-blue-200 bg-blue-50 p-3" role="group" aria-label={t('title')}>
      <p className="font-medium">{t('title')}</p>
      <p className="mt-1 text-sm text-slate-700">{t('hint')}</p>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={finalsBlock}
          onChange={(e) => setFinalsBlock(e.target.checked)}
        />
        {t('finalsBlock')}
      </label>
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/competitions/${competition.id}/schedule/generate`, {
                method: 'POST',
                body: { categoryPins: [], finalsBlock },
              });
              setOpen(false);
              await onDone();
            })
          }
        >
          {t('confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

function PublishAction({ schedule, competitionId, onDone }: { schedule: ScheduleDto; competitionId: string; onDone: () => Promise<void> }) {
  const t = useTranslations('scheduling.publish');
  const [open, setOpen] = useState(false);
  const action = useAction();
  if (!open) return <Button onClick={() => setOpen(true)}>{t('action')}</Button>;
  return (
    <div className="w-full rounded-md border border-blue-200 bg-blue-50 p-3" role="group" aria-label={t('title')}>
      <p className="font-medium">{t('title')}</p>
      <p className="mt-1 text-sm text-slate-700">{t('consequences')}</p>
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/competitions/${competitionId}/schedule/publish`, {
                method: 'POST',
                body: {},
                version: schedule.version,
              });
              setOpen(false);
              await onDone();
            })
          }
        >
          {t('confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

function MatchRow({
  item,
  timezone,
  canManage,
  schedule,
  competitionId,
  mats,
  sessions,
  onDone,
}: {
  item: ScheduleMatchDto;
  timezone: string;
  canManage: boolean;
  schedule: ScheduleDto;
  competitionId: string;
  mats: MatDto[];
  sessions: ScheduleSessionDto[];
  onDone: () => Promise<void>;
}) {
  const locale = useLocale();
  const t = useTranslations('scheduling.board');
  const [moving, setMoving] = useState(false);
  return (
    <li className={item.noMatch ? 'py-2 opacity-60' : 'py-2'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="w-14 shrink-0 font-mono">{timeInZone(item.plannedAt, timezone, locale)}</span>
        <span className="w-10 shrink-0 text-slate-500">№{item.matchNumber ?? '—'}</span>
        <span className="text-slate-600">{pickName(item.categoryName, locale)}</span>
        <span className="text-slate-500">{item.roundLabel}</span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.red.publicName ?? (item.red.bye ? t('bye') : '—')} — {item.blue.publicName ?? (item.blue.bye ? t('bye') : '—')}
        </span>
        {item.locked ? <Badge tone="info">{t('locked')}</Badge> : null}
        {item.noMatch ? <Badge tone="neutral">{t('noMatch')}</Badge> : <MatchStatusBadge status={item.status} />}
        {canManage && !item.noMatch ? (
          <Button size="sm" variant="ghost" onClick={() => setMoving((v) => !v)} className="print:hidden">
            {t('move')}
          </Button>
        ) : null}
      </div>
      {moving ? (
        <MoveMatchForm
          item={item}
          schedule={schedule}
          competitionId={competitionId}
          mats={mats}
          sessions={sessions}
          onDone={onDone}
          onClose={() => setMoving(false)}
        />
      ) : null}
    </li>
  );
}

function ScheduleBoard({
  schedule,
  competition,
  mats,
  sessions,
  onDone,
}: {
  schedule: ScheduleDto;
  competition: Competition;
  mats: MatDto[];
  sessions: ScheduleSessionDto[];
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('scheduling.board');
  const locale = useLocale();
  const canManage = competition.allowedActions.includes('schedule.manage');
  if (schedule.items.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <div className="space-y-6">
      {sessions.map((session) => {
        const sessionItems = schedule.items.filter((i) => i.sessionId === session.id);
        if (sessionItems.length === 0) return null;
        return (
          <div key={session.id} className="break-inside-avoid">
            <h3 className="mb-2 text-base font-semibold">
              {session.name} · {timeInZone(session.startsAt, competition.timezone, locale)}–
              {timeInZone(session.endsAt, competition.timezone, locale)}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mats
                .filter((mat) => sessionItems.some((i) => i.matId === mat.id))
                .map((mat) => {
                  const items = sessionItems
                    .filter((i) => i.matId === mat.id)
                    .sort((a, b) => a.orderInMat - b.orderInMat);
                  return (
                    <Card key={mat.id} className="break-inside-avoid print:border print:shadow-none">
                      <CardTitle>
                        №{mat.number} {mat.name ?? ''}
                      </CardTitle>
                      <ul className="divide-y divide-slate-100">
                        {items.map((item) => (
                          <MatchRow
                            key={item.matchId}
                            item={item}
                            timezone={competition.timezone}
                            canManage={canManage}
                            schedule={schedule}
                            competitionId={competition.id}
                            mats={mats}
                            sessions={sessions}
                            onDone={onDone}
                          />
                        ))}
                      </ul>
                    </Card>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UnassignedPanel({ schedule }: { schedule: ScheduleDto }) {
  const t = useTranslations('scheduling.unassigned');
  const locale = useLocale();
  if (schedule.unassigned.length === 0) return null;
  return (
    <Alert tone="warning" className="print:hidden">
      <p className="font-medium">{t('title', { count: schedule.unassigned.length })}</p>
      <ul className="mt-2 list-inside list-disc text-sm">
        {schedule.unassigned.map((u) => (
          <li key={u.matchId}>
            №{u.matchNumber ?? '—'} {pickName(u.categoryName, locale)} · {u.roundLabel} — {t(`reasons.${u.reason}`)}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export function ScheduleTab({ competition }: { competition: Competition }) {
  const t = useTranslations('scheduling');
  const matsQuery = useMats(competition.id);
  const sessionsQuery = useSessions(competition.id);
  const scheduleQuery = useSchedule(competition.id);
  const invalidate = useInvalidateScheduling(competition.id);
  const can = (a: string): boolean => competition.allowedActions.includes(a);
  return (
    <div className="space-y-4">
      <MatsSessionsPanel competition={competition} />
      <QueryState isPending={scheduleQuery.isPending || matsQuery.isPending || sessionsQuery.isPending} error={scheduleQuery.error ?? matsQuery.error ?? sessionsQuery.error}>
        {() => {
          const schedule = scheduleQuery.data as ScheduleDto;
          const mats = matsQuery.data ?? [];
          const sessions = sessionsQuery.data ?? [];
          return (
            <>
              <div className="flex flex-wrap items-start gap-2 print:hidden">
                {can('schedule.manage') ? <GenerateAction competition={competition} onDone={invalidate} /> : null}
                {can('schedule.publish') && schedule.status === 'DRAFT' ? (
                  <PublishAction schedule={schedule} competitionId={competition.id} onDone={invalidate} />
                ) : null}
                {schedule.status === 'PUBLISHED' ? <Badge tone="success">{t('published')}</Badge> : null}
                <Button variant="secondary" onClick={() => window.print()}>
                  {t('print')}
                </Button>
              </div>
              <UnassignedPanel schedule={schedule} />
              <ScheduleBoard
                schedule={schedule}
                competition={competition}
                mats={mats}
                sessions={sessions}
                onDone={invalidate}
              />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
