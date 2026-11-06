'use client';
// «Поделиться» (правки 05.11.2026): системное меню «Поделиться» телефона, если оно есть; иначе — меню со ссылками в
// мессенджеры и на почту и копированием ссылки.
import { Button, cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** Значок «Поделиться»: три связанные точки. */
export function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-5 w-5', className)} fill="none">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Значок «Скачать»: стрелка вниз в лоток. */
export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-5 w-5', className)} fill="none">
      <path d="M12 3v12m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function absolute(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

export function ShareButton({
  title,
  text,
  path,
  label,
  variant = 'secondary',
}: {
  title: string;
  text?: string;
  /** Путь или полный адрес; по умолчанию — текущая страница. */
  path?: string;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTranslations('tournamentPage.share');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const url = (): string => (path ? absolute(path) : window.location.href);

  const share = async (): Promise<void> => {
    const data = { title, text: text ?? title, url: url() };
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.(data) !== false) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    setOpen((v) => !v);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('copyPrompt'), url());
    }
  };

  const enc = (v: string) => encodeURIComponent(v);
  const links = (): { key: string; href: string }[] => {
    const u = url();
    const msg = `${text ?? title}\n${u}`;
    return [
      { key: 'telegram', href: `https://t.me/share/url?url=${enc(u)}&text=${enc(text ?? title)}` },
      { key: 'whatsapp', href: `https://wa.me/?text=${enc(msg)}` },
      { key: 'vk', href: `https://vk.com/share.php?url=${enc(u)}&title=${enc(title)}` },
      { key: 'email', href: `mailto:?subject=${enc(title)}&body=${enc(msg)}` },
    ];
  };

  return (
    <div className="relative inline-block" ref={box}>
      <Button variant={variant} onClick={() => void share()} aria-expanded={open} aria-haspopup="menu">
        <ShareIcon className="mr-2" />
        {label ?? t('button')}
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
        >
          {links().map((l) => (
            <a
              key={l.key}
              role="menuitem"
              href={l.href}
              target={l.key === 'email' ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-slate-800 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true" className="w-5 text-center">
                {l.key === 'telegram' ? '✈️' : l.key === 'whatsapp' ? '💬' : l.key === 'vk' ? '🅥' : '✉️'}
              </span>
              {t(l.key)}
            </a>
          ))}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-800 hover:bg-slate-100"
            onClick={() => void copy()}
          >
            <span aria-hidden="true" className="w-5 text-center">
              🔗
            </span>
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
