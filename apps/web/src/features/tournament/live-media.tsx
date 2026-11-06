'use client';
// Прямая трансляция (плеер YouTube, Rutube, VK Видео и табло ковров) и медиа завершённого турнира (фото и видео)
// на публичной странице (правки 05.11.2026).
import {
  type CompetitionMediaDto,
  type PublicCompetition,
  type PublicLiveDto,
  stageOfCompetition,
} from '@sde/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { embedUrl } from './embed';
import { Box, Placeholder } from './ui';

// ---------- Прямая трансляция ----------

export function LiveSection({
  competition: c,
  data,
}: {
  competition: PublicCompetition;
  data: PublicLiveDto | null;
}) {
  const t = useTranslations('tournamentPage.live');
  const stage = stageOfCompetition(c.status);
  if (stage !== 'LIVE') return <Placeholder icon="📺" title={t('soonTitle')} text={t('soonText')} />;
  const embed = data?.streamUrl ? embedUrl(data.streamUrl) : null;
  return (
    <div className="space-y-4">
      {data?.streamUrl ? (
        <Box>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span
              className="stage-pulse inline-block h-2.5 w-2.5 rounded-full bg-red-600"
              aria-hidden="true"
            />
            {t('stream')}
          </h3>
          {embed ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={embed}
                title={t('stream')}
                className="h-full w-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : null}
          <a
            href={data.streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center text-blue-700 underline"
          >
            {t('openStream')}
          </a>
        </Box>
      ) : null}
      <Box>
        <h3 className="mb-1 text-lg font-semibold">{t('mats')}</h3>
        <p className="mb-3 text-sm text-slate-600">{t('matsHint')}</p>
        {(data?.mats ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">{t('noMats')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.mats ?? []).map((m) => (
              <li key={m.id}>
                <Link
                  href={`/scoreboard/mat/${m.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-blue-400"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-700 text-lg font-bold text-white">
                    {m.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{m.name ?? t('mat', { number: m.number })}</span>
                    <span className="text-xs text-slate-600">{t('scoreboard')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}

// ---------- Медиа ----------

export function MediaSection({ media }: { media: CompetitionMediaDto[] | null }) {
  const t = useTranslations('tournamentPage.media');
  const [open, setOpen] = useState<number | null>(null);
  const photos = (media ?? []).filter((m) => m.kind === 'PHOTO');
  const videos = (media ?? []).filter((m) => m.kind === 'VIDEO');
  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, photos.length]);
  if (photos.length === 0 && videos.length === 0)
    return <Placeholder icon="📸" title={t('emptyTitle')} text={t('emptyText')} />;
  const shown = open !== null ? photos[open] : undefined;
  return (
    <div className="space-y-4">
      {videos.length > 0 ? (
        <Box>
          <h3 className="mb-3 text-lg font-semibold">{t('videos')}</h3>
          <ul className="grid gap-4 md:grid-cols-2">
            {videos.map((v) => {
              const embed = embedUrl(v.url);
              return (
                <li key={v.id}>
                  {embed ? (
                    <div className="aspect-video overflow-hidden rounded-lg bg-black">
                      <iframe
                        src={embed}
                        title={v.caption ?? t('video')}
                        className="h-full w-full"
                        allowFullScreen
                      />
                    </div>
                  ) : null}
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex min-h-11 items-center text-sm text-blue-700 underline"
                  >
                    {v.caption ?? t('openVideo')}
                  </a>
                </li>
              );
            })}
          </ul>
        </Box>
      ) : null}
      {photos.length > 0 ? (
        <Box>
          <h3 className="mb-3 text-lg font-semibold">{t('photos', { count: photos.length })}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="group block aspect-square w-full overflow-hidden rounded-lg bg-slate-100"
                  aria-label={p.caption ?? t('photo', { n: i + 1 })}
                >
                  <img
                    src={p.url}
                    alt={p.caption ?? ''}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </button>
              </li>
            ))}
          </ul>
        </Box>
      ) : null}
      {shown ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={shown.caption ?? t('photo', { n: (open ?? 0) + 1 })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
        >
          <img
            src={shown.url}
            alt={shown.caption ?? ''}
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
          {shown.caption ? (
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white">
              {shown.caption}
            </p>
          ) : null}
          <button
            type="button"
            className="absolute right-4 top-4 text-3xl text-white"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
