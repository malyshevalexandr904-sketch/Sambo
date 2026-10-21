'use client';
// Информационное окно «О платформе и рейтинге»: две вкладки («О платформе», «Система рейтинга»), в каждой
// раскрывающиеся разделы. Сведения о рейтинге совпадают с версией правил sambo-elo@1
// (packages/rating/src/rules.ts; docs/RATING_RULES.md, RATED_TOURNAMENT_FORMAT.md): старт 200, коэффициент 60 / 30 / 10,
// уровни через 200. Нативный <dialog>: фокус внутри окна, закрытие по Esc, кнопке и щелчку по фону. Вкладки по
// шаблону WAI-ARIA (стрелки влево и вправо). Текст окна набран шрифтом Times New Roman.
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';

type Tab = 'platform' | 'rating';

/** Содержимое раздела: абзацы, списки и таблицы по ключам словаря `about.<tab>.<section>.<key>`. */
type Block =
  | { p: string }
  | { ul: readonly string[] }
  | { ol: readonly string[] }
  | { named: readonly string[] }
  | { table: readonly (readonly [string, string])[]; head: readonly [string, string] };

const TABS: readonly Tab[] = ['platform', 'rating'];

const SECTIONS: Record<Tab, readonly { key: string; blocks: readonly Block[] }[]> = {
  platform: [
    { key: 'what', blocks: [{ p: 'p1' }, { p: 'p2' }] },
    { key: 'roles', blocks: [{ p: 'intro' }, { ul: ['head', 'coach', 'athlete', 'referee', 'guest'] }] },
    {
      key: 'register',
      blocks: [
        { ol: ['s1', 's2', 's3', 's4', 's5'] },
        { p: 'common' },
        { named: ['head', 'coach', 'referee', 'athlete'] },
        { p: 'note' },
      ],
    },
    { key: 'tournaments', blocks: [{ ol: ['s1', 's2', 's3', 's4', 's5'] }, { p: 'note' }] },
    { key: 'notifications', blocks: [{ p: 'p1' }, { p: 'p2' }] },
    { key: 'data', blocks: [{ p: 'p1' }, { p: 'p2' }] },
  ],
  rating: [
    { key: 'how', blocks: [{ p: 'p1' }, { p: 'p2' }, { p: 'p3' }] },
    { key: 'opponent', blocks: [{ p: 'p1' }, { p: 'p2' }] },
    { key: 'wins', blocks: [{ ul: ['clean', 'points', 'small', 'minimal'] }, { p: 'loss' }, { p: 'note' }] },
    {
      key: 'factor',
      blocks: [
        { p: 'p1' },
        {
          head: ['colRating', 'colValue'],
          table: [
            ['row1', 'v1'],
            ['row2', 'v2'],
            ['row3', 'v3'],
          ],
        },
        { p: 'p2' },
      ],
    },
    { key: 'counted', blocks: [{ ul: ['l1', 'l2', 'l3', 'l4'] }] },
    { key: 'tournaments', blocks: [{ p: 'p1' }, { ul: ['l1', 'l2', 'l3', 'l4'] }] },
    {
      key: 'levels',
      blocks: [
        { p: 'p1' },
        {
          head: ['colLevel', 'colRating'],
          table: [
            ['l1', 'r1'],
            ['l2', 'r2'],
            ['l3', 'r3'],
            ['l4', 'r4'],
            ['l5', 'r5'],
            ['l6', 'r6'],
            ['l7', 'r7'],
            ['l8', 'r8'],
            ['l9', 'r9'],
            ['l10', 'r10'],
          ],
        },
      ],
    },
    { key: 'seasons', blocks: [{ p: 'p1' }, { p: 'p2' }] },
    { key: 'corrections', blocks: [{ p: 'p1' }, { p: 'p2' }] },
    { key: 'where', blocks: [{ ul: ['l1', 'l2', 'l3'] }, { p: 'privacy' }] },
  ],
};

const SERIF = { fontFamily: '"Times New Roman", Times, serif' };
const TEXT = 'text-base leading-relaxed text-slate-800';

export function AboutPlatform({
  section = 'platform',
  variant = 'button',
}: {
  /** Какая вкладка открыта при открытии окна. */
  section?: Tab;
  /** Кнопка с рамкой (первый экран) или ссылка (страница рейтинга). */
  variant?: 'button' | 'link';
}) {
  const t = useTranslations('about');
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(section);

  const select = (next: Tab, focus = false) => {
    setTab(next);
    body.current?.scrollTo({ top: 0 });
    if (focus) ref.current?.querySelector<HTMLElement>(`#about-tab-${next}`)?.focus();
  };
  const open = () => {
    setTab(section);
    ref.current?.showModal();
    body.current?.scrollTo({ top: 0 });
  };
  const close = () => ref.current?.close();
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (next) select(next, true);
  };

  const block = (b: Block, base: string, i: number) => {
    if ('p' in b)
      return (
        <p key={i} className={`mt-2 ${TEXT}`}>
          {t(`${base}.${b.p}`)}
        </p>
      );
    if ('named' in b)
      return (
        <ul key={i} className={`mt-2 space-y-2 ${TEXT}`}>
          {b.named.map((k) => (
            <li key={k} className="rounded-md border border-slate-200 px-3 py-2">
              <span className="block font-bold text-slate-900">{t(`${base}.${k}.name`)}</span>
              {t(`${base}.${k}.text`)}
            </li>
          ))}
        </ul>
      );
    if ('ul' in b || 'ol' in b) {
      const items = 'ul' in b ? b.ul : b.ol;
      const List = 'ul' in b ? 'ul' : 'ol';
      return (
        <List key={i} className={`mt-2 space-y-1 pl-6 ${TEXT} ${'ul' in b ? 'list-disc' : 'list-decimal'}`}>
          {items.map((k) => (
            <li key={k}>{t(`${base}.${k}`)}</li>
          ))}
        </List>
      );
    }
    return (
      <table key={i} className={`mt-3 w-full max-w-md border-collapse ${TEXT}`}>
        <thead>
          <tr>
            {b.head.map((h, j) => (
              <th
                key={h}
                scope="col"
                className={`border border-slate-300 bg-slate-50 px-3 py-2 ${j === 1 ? 'text-right' : 'text-left'}`}
              >
                {t(`${base}.${h}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.table.map(([a, v]) => (
            <tr key={a}>
              <td className="border border-slate-300 px-3 py-2">{t(`${base}.${a}`)}</td>
              <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">
                {t(`${base}.${v}`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={
          variant === 'button'
            ? 'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 font-medium text-slate-900 hover:bg-slate-50'
            : 'inline-flex min-h-11 items-center text-blue-700 underline'
        }
      >
        {variant === 'button' ? t('open') : t('openRating')}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="about-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
        style={SERIF}
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="border-b border-slate-200 px-5 pt-4">
            <div className="flex items-start justify-between gap-4">
              <h2 id="about-title" className="text-2xl font-bold text-slate-900">
                {t('title')}
              </h2>
              <button
                type="button"
                onClick={close}
                className="min-h-11 min-w-11 rounded-md border border-slate-300 px-3 text-slate-900 hover:bg-slate-50"
              >
                {t('close')}
              </button>
            </div>
            <div role="tablist" aria-label={t('tabsLabel')} className="mt-3 flex gap-1" onKeyDown={onTabKey}>
              {TABS.map((k) => (
                <button
                  key={k}
                  id={`about-tab-${k}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  aria-controls={`about-panel-${k}`}
                  tabIndex={tab === k ? 0 : -1}
                  onClick={() => select(k)}
                  className={`-mb-px min-h-11 rounded-t-md border px-4 text-base font-bold ${
                    tab === k
                      ? 'border-slate-200 border-b-white bg-white text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t(`tabs.${k}`)}
                </button>
              ))}
            </div>
          </header>

          <div ref={body} className="overflow-y-auto px-5 pt-4 pb-6">
            {TABS.map((k) => (
              <div
                key={k}
                id={`about-panel-${k}`}
                role="tabpanel"
                aria-labelledby={`about-tab-${k}`}
                hidden={tab !== k}
              >
                <p className="text-sm text-slate-600">{t('hint')}</p>
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {SECTIONS[k].map((s, i) => (
                    <details key={s.key} open={i === 0} className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-lg font-bold text-slate-900">
                        {t(`${k}.${s.key}.title`)}
                        <span
                          aria-hidden="true"
                          className="text-slate-500 transition-transform group-open:rotate-90"
                        >
                          ›
                        </span>
                      </summary>
                      <div className="pb-4">{s.blocks.map((b, j) => block(b, `${k}.${s.key}`, j))}</div>
                    </details>
                  ))}
                </div>
                {k === 'rating' && variant === 'button' ? (
                  <Link
                    href="/rating"
                    onClick={close}
                    className="mt-4 inline-flex min-h-11 items-center text-blue-700 underline"
                  >
                    {t('linkRating')}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
