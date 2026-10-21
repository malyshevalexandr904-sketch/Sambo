'use client';
// Информационное окно «О платформе и рейтинге»: что такое платформа, порядок доступа и как считается
// рейтинг (docs/RATING_RULES.md, RATED_TOURNAMENT_FORMAT.md). Числа совпадают с версией правил sambo-elo@1
// (packages/rating/src/rules.ts): старт 200, коэффициент 60 / 30 / 10, уровни через 200. Нативный <dialog>:
// фокус внутри окна, закрытие по Esc, кнопке и щелчку по фону. Текст окна набран шрифтом Times New Roman.
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Link } from '@/i18n/navigation';

const FEATURES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;
const FACTORS = ['factor1', 'factor2', 'factor3'] as const;
const WINS = ['winClean', 'winPoints', 'winSmall', 'winMinimal'] as const;
const K_ROWS = [
  ['kRow1', 60],
  ['kRow2', 30],
  ['kRow3', 10],
] as const;

const SERIF = { fontFamily: '"Times New Roman", Times, serif' };

export function AboutPlatform({
  section = 'platform',
  variant = 'button',
}: {
  /** С какого раздела открыть окно. */
  section?: 'platform' | 'rating';
  /** Кнопка с рамкой (первый экран) или ссылка (страница рейтинга). */
  variant?: 'button' | 'link';
}) {
  const t = useTranslations('about');
  const ref = useRef<HTMLDialogElement>(null);

  const open = () => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const target = dialog.querySelector<HTMLElement>(`#about-${section}`);
    if (target && section !== 'platform') target.scrollIntoView({ block: 'start' });
    else dialog.querySelector<HTMLElement>('[data-about-body]')?.scrollTo({ top: 0 });
  };
  const close = () => ref.current?.close();

  const h3 = 'mt-5 text-lg font-bold text-slate-900';
  const p = 'mt-2 text-base leading-relaxed text-slate-800';

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
        className="m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
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

          <div data-about-body className="overflow-y-auto px-5 pb-6">
            <section id="about-platform" aria-labelledby="about-platform-title">
              <h3 id="about-platform-title" className="mt-4 text-xl font-bold text-slate-900">
                {t('platform.title')}
              </h3>
              <p className={p}>{t('platform.p1')}</p>
              <h4 className={h3}>{t('platform.featuresTitle')}</h4>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-base leading-relaxed text-slate-800">
                {FEATURES.map((k) => (
                  <li key={k}>{t(`platform.${k}`)}</li>
                ))}
              </ul>
              <h4 className={h3}>{t('platform.accessTitle')}</h4>
              <p className={p}>{t('platform.a1')}</p>
              <p className={p}>{t('platform.a2')}</p>
            </section>

            <section
              id="about-rating"
              aria-labelledby="about-rating-title"
              className="mt-6 scroll-mt-2 border-t border-slate-200 pt-2"
            >
              <h3 id="about-rating-title" className="mt-4 text-xl font-bold text-slate-900">
                {t('rating.title')}
              </h3>
              <p className={p}>{t('rating.p1')}</p>

              <h4 className={h3}>{t('rating.startTitle')}</h4>
              <p className={p}>{t('rating.start')}</p>

              <h4 className={h3}>{t('rating.factorsTitle')}</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-6 text-base leading-relaxed text-slate-800">
                {FACTORS.map((k) => (
                  <li key={k}>{t(`rating.${k}`)}</li>
                ))}
              </ol>

              <h4 className={h3}>{t('rating.winsTitle')}</h4>
              <ul className="mt-2 space-y-2 text-base leading-relaxed text-slate-800">
                {WINS.map((k) => (
                  <li key={k}>
                    <span className="font-bold">{t(`rating.${k}.name`)}.</span> {t(`rating.${k}.text`)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-slate-600">{t('rating.winsNote')}</p>

              <h4 className={h3}>{t('rating.kTitle')}</h4>
              <p className={p}>{t('rating.kText')}</p>
              <table className="mt-2 w-full max-w-md border-collapse text-base text-slate-800">
                <thead>
                  <tr>
                    <th scope="col" className="border border-slate-300 px-3 py-2 text-left">
                      {t('rating.kColRating')}
                    </th>
                    <th scope="col" className="border border-slate-300 px-3 py-2 text-right">
                      {t('rating.kColValue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {K_ROWS.map(([k, v]) => (
                    <tr key={k}>
                      <td className="border border-slate-300 px-3 py-2">{t(`rating.${k}`)}</td>
                      <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4 className={h3}>{t('rating.tournamentsTitle')}</h4>
              <p className={p}>{t('rating.tournaments')}</p>
              <p className={p}>{t('rating.draw')}</p>

              <h4 className={h3}>{t('rating.levelsTitle')}</h4>
              <p className={p}>{t('rating.levels')}</p>

              <h4 className={h3}>{t('rating.seasonsTitle')}</h4>
              <p className={p}>{t('rating.seasons')}</p>

              <h4 className={h3}>{t('rating.privacyTitle')}</h4>
              <p className={p}>{t('rating.privacy')}</p>

              {variant === 'button' ? (
                <Link
                  href="/rating"
                  onClick={close}
                  className="mt-5 inline-flex min-h-11 items-center text-blue-700 underline"
                >
                  {t('linkRating')}
                </Link>
              ) : null}
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}
