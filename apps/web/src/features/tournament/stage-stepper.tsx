'use client';
// Шкала стадий проведения турнира (правки 05.11.2026): пройденные — галочкой, текущая — выделена, следующие —
// бледно. На публичной странице — с «Опубликован», в управлении — с «Черновика».
import { type TournamentStage, TOURNAMENT_STAGES } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';

const PUBLIC_FROM = TOURNAMENT_STAGES.indexOf('PUBLISHED');

export function StageStepper({
  stage,
  variant = 'public',
  className,
}: {
  stage: TournamentStage | null;
  variant?: 'public' | 'manage';
  className?: string;
}) {
  const t = useTranslations('stages');
  const stages = variant === 'public' ? TOURNAMENT_STAGES.slice(PUBLIC_FROM) : TOURNAMENT_STAGES;
  const current = stage ? stages.indexOf(stage) : -1;
  return (
    <ol className={cn('relative flex gap-1 overflow-x-auto pb-1', className)} aria-label={t('label')}>
      {stages.map((s, i) => {
        const done = current >= 0 && i < current;
        const active = i === current;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-24 flex-1 flex-col items-center gap-1 text-center text-xs',
              active ? 'font-semibold text-blue-800' : done ? 'text-slate-700' : 'text-slate-400',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs',
                active
                  ? 'stage-pulse border-blue-700 bg-blue-700 text-white'
                  : done
                    ? 'border-green-600 bg-green-50 text-green-700'
                    : 'border-slate-300 bg-slate-50',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className="leading-tight">{t(`names.${s}`)}</span>
            <span className="sr-only">{active ? t('current') : done ? t('done') : t('upcoming')}</span>
          </li>
        );
      })}
    </ol>
  );
}
