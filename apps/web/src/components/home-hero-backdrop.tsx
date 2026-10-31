'use client';
// Фон первого экрана (правки 31.10.2026): зал, два самбиста в красной и синей куртках в лучах прожекторов.
// Сначала всегда рисуется неподвижный кадр (он же запасной вариант), видео подгружается только на широком экране,
// без «уменьшить движение» и без режима экономии трафика. Видео зациклено «туда-обратно», поэтому шва нет.
// Кадр и видео сгенерированы в Higgsfield для этого сайта и лежат у нас же (public/media/hero), чужих адресов нет.
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

const POSTER = '/media/hero/hero-poster-1920.jpg';
const POSTER_SMALL = '/media/hero/hero-poster-960.jpg';
const VIDEO = '/media/hero/hero-loop.mp4';

/** Видео есть смысл грузить: широкий экран, движение не отключено, трафик не экономится. */
function videoAllowed(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (!window.matchMedia('(min-width: 768px) and (prefers-reduced-motion: no-preference)').matches) {
    return false;
  }
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

export function HomeHeroBackdrop() {
  const t = useTranslations('home');
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (videoAllowed()) setSrc(VIDEO);
  }, []);

  // Экран прокручен ниже — видео останавливается, чтобы не тратить батарею; вернулись — снова играет.
  useEffect(() => {
    const el = video.current;
    if (!src || !el || paused || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void el.play().catch(() => undefined);
      else el.pause();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [src, paused]);

  const toggle = (): void => {
    const el = video.current;
    if (!el) return;
    if (paused) {
      setPaused(false);
      void el.play().catch(() => undefined);
    } else {
      setPaused(true);
      el.pause();
    }
  };

  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden bg-[#070d1a]">
        <img
          src={POSTER}
          srcSet={`${POSTER_SMALL} 960w, ${POSTER} 1920w`}
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover object-[72%_center] ${playing ? '' : 'hero-still'}`}
        />
        {src ? (
          <video
            ref={video}
            src={src}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onError={() => setSrc(null)}
            className={`absolute inset-0 h-full w-full object-cover object-[72%_center] transition-opacity duration-1000 ${
              playing ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : null}
        {/* Затемнение: слева под текстом сильнее, внизу — плавный переход в страницу. */}
        <div className="absolute inset-0 bg-[#070d1a]/45 md:bg-transparent md:bg-gradient-to-r md:from-[#070d1a]/90 md:via-[#070d1a]/55 md:to-[#070d1a]/10" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#070d1a] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#070d1a]/70 to-transparent" />
      </div>
      {src && playing ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={paused ? t('videoPlay') : t('videoPause')}
          title={paused ? t('videoPlay') : t('videoPause')}
          className="absolute bottom-4 right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/30 text-sm text-white/80 backdrop-blur transition hover:bg-black/50 hover:text-white"
        >
          <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
        </button>
      ) : null}
    </>
  );
}
