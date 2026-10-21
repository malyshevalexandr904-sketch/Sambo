'use client';
// Информационное окно «О платформе» на первом экране: раскрывающиеся разделы о назначении платформы, ролях,
// регистрации, турнирах, уведомлениях и защите данных. Нативный <dialog>: фокус внутри окна, закрытие по Esc,
// кнопке и щелчку по фону. Текст окна набран шрифтом Times New Roman.
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

/** Содержимое раздела: абзац (`p`) или список (`ul`, `ol`, `named` с жирным названием) по ключам словаря. */
interface Block {
  p?: string;
  ul?: readonly string[];
  ol?: readonly string[];
  named?: readonly string[];
}

const SECTIONS: readonly { key: string; blocks: readonly Block[] }[] = [
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
];

const SERIF = { fontFamily: '"Times New Roman", Times, serif' };
const TEXT = 'text-base leading-relaxed text-slate-800';

export function AboutPlatform() {
  const t = useTranslations('about');
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const open = () => {
    ref.current?.showModal();
    body.current?.scrollTo({ top: 0 });
  };
  const close = () => ref.current?.close();

  const block = (b: Block, base: string, i: number) => {
    if (b.p)
      return (
        <p key={i} className={`mt-2 ${TEXT}`}>
          {t(`${base}.${b.p}`)}
        </p>
      );
    if (b.named)
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
    const items = b.ul ?? b.ol ?? [];
    const List = b.ul ? 'ul' : 'ol';
    return (
      <List key={i} className={`mt-2 space-y-1 pl-6 ${TEXT} ${b.ul ? 'list-disc' : 'list-decimal'}`}>
        {items.map((k) => (
          <li key={k}>{t(`${base}.${k}`)}</li>
        ))}
      </List>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 font-medium text-slate-900 hover:bg-slate-50"
      >
        {t('open')}
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
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
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
          </header>

          <div ref={body} className="overflow-y-auto px-5 pt-4 pb-6">
            <p className="text-sm text-slate-600">{t('hint')}</p>
            <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
              {SECTIONS.map((s, i) => (
                <details key={s.key} open={i === 0} className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-lg font-bold text-slate-900">
                    {t(`platform.${s.key}.title`)}
                    <span
                      aria-hidden="true"
                      className="text-slate-500 transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="pb-4">{s.blocks.map((b, j) => block(b, `platform.${s.key}`, j))}</div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
