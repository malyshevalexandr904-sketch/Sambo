'use client';
// Фирменное положение «Цифровое Самбо» (правки 05.11.2026, п. 8): платформа собирает PDF по данным заявки или
// турнира. Карточка со ссылками «Открыть» (просмотр в новой вкладке) и «Скачать» (`?download=1`).
import { Card, CardTitle } from '@sde/ui';
import { useTranslations } from 'next-intl';

const LINK =
  'inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors';

export function GeneratedRegulationCard({ href, draft }: { href: string; draft: boolean }) {
  const t = useTranslations('generatedRegulation');
  return (
    <Card>
      <div className="flex items-start gap-4">
        <DocumentIcon />
        <div className="min-w-0 flex-1">
          <CardTitle>{t('title')}</CardTitle>
          <p className="text-sm text-slate-600">{draft ? t('draftText') : t('text')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${LINK} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}
            >
              <EyeIcon />
              {t('open')}
            </a>
            <a
              href={`${href}?download=1`}
              download
              className={`${LINK} border-slate-300 bg-white text-slate-900 hover:bg-slate-50`}
            >
              <DownloadIcon />
              {t('download')}
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 40 48" className="h-12 w-10 shrink-0" aria-hidden="true">
      <path
        d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill="#EEF2FB"
        stroke="#2B4FA8"
        strokeWidth="2"
      />
      <path d="M26 2v10h10" fill="none" stroke="#2B4FA8" strokeWidth="2" />
      <rect x="8" y="20" width="16" height="2.5" rx="1" fill="#2B4FA8" />
      <rect x="8" y="26" width="22" height="2.5" rx="1" fill="#2B4FA8" opacity="0.5" />
      <rect x="8" y="32" width="22" height="2.5" rx="1" fill="#2B4FA8" opacity="0.5" />
      <rect x="8" y="38" width="12" height="2.5" rx="1" fill="#C62F3E" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
