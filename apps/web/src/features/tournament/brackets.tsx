'use client';
// Турнирные сетки и итоговые протоколы публичной страницы (правки 05.11.2026): категории, круги, схватки; после
// завершения — места с медалями, скачивание протокола (CSV) и печать.
import {
  categoryWeightLabel,
  type PublicBracketsDto,
  type PublicCategoryBracket,
  type PublicCompetition,
  stageOfCompetition,
} from '@sde/contracts';
import { Alert, Button, cn } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { DownloadIcon } from './share';
import { Box, Placeholder } from './ui';

// ---------- Турнирные сетки и протоколы ----------

const MEDAL: Record<string, string> = { GOLD: '🥇', SILVER: '🥈', BRONZE: '🥉' };

function protocolCsv(cat: PublicCategoryBracket, title: string, hidden: string): string {
  const names = new Map(cat.participants.map((p) => [p.entryId, p]));
  const rows = [['Место', 'Спортсмен', 'Клуб', 'Регион', 'Побед', 'Поражений']];
  for (const p of cat.placements ?? []) {
    const info = names.get(p.entryId);
    rows.push([
      String(p.place),
      info?.name ?? hidden,
      info?.club ?? '',
      info?.region ?? '',
      String(p.wins),
      String(p.losses),
    ]);
  }
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return `\uFEFF${title}\n${rows.map((r) => r.map(esc).join(';')).join('\n')}`;
}

function CategoryBracket({ cat, final }: { cat: PublicCategoryBracket; final: boolean }) {
  const t = useTranslations('tournamentPage.brackets');
  const tr = useTranslations('bracket');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const title = `${lang === 'en' ? cat.name.en : cat.name.ru}`;
  const names = new Map(cat.participants.map((p) => [p.entryId, p]));
  const rounds = useMemo(() => {
    const m = new Map<string, typeof cat.matches>();
    for (const x of [...cat.matches].sort((a, b) => a.round - b.round || a.position - b.position)) {
      const key =
        x.stage === 'REPECHAGE' || x.label === 'BRONZE' ? `${x.stage}:${x.label}` : `${x.stage}:${x.round}`;
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return [...m.values()];
  }, [cat]);
  const download = (): void => {
    const blob = new Blob([protocolCsv(cat, title, t('hiddenName'))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `protokol-${cat.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      {cat.placements ? (
        <Box className="print-area">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">{t('protocol')}</h4>
            <div className="flex gap-2 print:hidden">
              <Button size="sm" variant="secondary" onClick={download}>
                <DownloadIcon className="mr-1.5 h-4 w-4" />
                {t('downloadCsv')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                {t('print')}
              </Button>
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-2 font-medium">{t('place')}</th>
                <th className="py-2 pr-2 font-medium">{t('athlete')}</th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">{t('club')}</th>
                <th className="py-2 text-right font-medium">{t('winsLosses')}</th>
              </tr>
            </thead>
            <tbody>
              {cat.placements.map((p) => {
                const info = names.get(p.entryId);
                return (
                  <tr
                    key={p.entryId}
                    className={cn('border-b border-slate-100', p.medal ? 'font-medium' : '')}
                  >
                    <td className="py-2 pr-2 tabular-nums">
                      {p.medal ? <span aria-hidden="true">{MEDAL[p.medal]} </span> : null}
                      {p.place}
                    </td>
                    <td className="py-2 pr-2">
                      {info?.name ?? <span className="text-slate-500">{t('hiddenName')}</span>}
                    </td>
                    <td className="hidden py-2 pr-2 text-slate-600 sm:table-cell">{info?.club ?? ''}</td>
                    <td className="py-2 text-right tabular-nums">
                      {p.wins} / {p.losses}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Box>
      ) : null}
      {rounds.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {rounds.map((list) => (
            <section key={`${list[0]?.stage}:${list[0]?.round}:${list[0]?.label}`} className="w-60 shrink-0">
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {list[0]?.group ? `${t('group')} ${list[0].group} · ` : ''}
                {tr.has(`rounds.${list[0]?.label ?? ''}`)
                  ? tr(`rounds.${list[0]?.label ?? ''}`)
                  : (list[0]?.label ?? '')}
              </h5>
              <ul className="space-y-2">
                {list.map((m) => (
                  <li
                    key={m.key}
                    className={cn(
                      'rounded-lg border bg-white text-sm shadow-sm',
                      m.status === 'IN_PROGRESS'
                        ? 'border-amber-400 ring-2 ring-amber-200'
                        : 'border-slate-200',
                    )}
                  >
                    {(['red', 'blue'] as const).map((side) => {
                      const won = m.winner === side.toUpperCase();
                      const n = m[side];
                      return (
                        <div
                          key={side}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5',
                            side === 'red' ? 'border-b border-slate-100' : '',
                            won ? 'font-semibold' : m.winner ? 'text-slate-500' : '',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'h-3 w-1.5 rounded-sm',
                              side === 'red' ? 'bg-red-600' : 'bg-blue-600',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {n ?? (m.status === 'PENDING' ? '—' : t('hiddenName'))}
                          </span>
                          {won ? <span aria-label={t('winner')}>✓</span> : null}
                        </div>
                      );
                    })}
                    {m.score || m.status === 'IN_PROGRESS' ? (
                      <p className="border-t border-slate-100 px-2 py-1 text-xs text-slate-600">
                        {m.status === 'IN_PROGRESS' ? (
                          <span className="text-amber-700">● {t('live')} </span>
                        ) : null}
                        {m.score ?? ''}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : final ? null : (
        <p className="text-sm text-slate-600">{t('noMatches')}</p>
      )}
    </div>
  );
}

export function BracketsSection({
  competition: c,
  data,
}: {
  competition: PublicCompetition;
  data: PublicBracketsDto | null;
}) {
  const t = useTranslations('tournamentPage.brackets');
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ru';
  const stage = stageOfCompetition(c.status);
  const cats = data?.categories ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  if (cats.length === 0)
    return stage === 'DRAW' ? (
      <Placeholder icon="🎲" title={t('drawingTitle')} text={t('drawingText')} />
    ) : (
      <Placeholder icon="🗂️" title={t('emptyTitle')} text={t('emptyText')} />
    );
  const current = cats.find((x) => x.code === selected) ?? cats[0];
  if (!current) return null;
  return (
    <div className="space-y-4">
      {stage === 'FINISHED' ? <Alert tone="success">{t('finalNote')}</Alert> : null}
      {stage === 'LIVE' ? <Alert tone="info">{t('liveNote')}</Alert> : null}
      <div role="tablist" aria-label={t('categories')} className="flex gap-2 overflow-x-auto pb-1">
        {cats.map((x) => (
          <button
            key={x.code}
            type="button"
            role="tab"
            aria-selected={x.code === current.code}
            onClick={() => setSelected(x.code)}
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-4 text-sm',
              x.code === current.code
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400',
            )}
          >
            {(lang === 'en' ? x.name.en : x.name.ru).split(',')[0]} · {categoryWeightLabel(x.weight, lang)}
          </button>
        ))}
      </div>
      <CategoryBracket cat={current} final={stage === 'FINISHED'} />
    </div>
  );
}
