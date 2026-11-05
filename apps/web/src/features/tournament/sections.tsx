'use client';
// Разделы публичной страницы турнира (правки 05.11.2026): положение и регистрация. Что показать в разделе,
// зависит от стадии турнира; сетки — в brackets.tsx, трансляция и медиа — в live-media.tsx.
import { type Competition, type PublicCompetition, stageOfCompetition } from '@sde/contracts';
import { Alert, Button } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { currentSubscription, enablePush, pushConfig, pushSupport } from '@/lib/push';
import { useMe } from '@/lib/queries';
import { DownloadIcon, ShareButton } from './share';
import type { TournamentLabels } from './labels';
import { Box, Placeholder } from './ui';
import { useViewerCompetition } from './viewer';

// ---------- Положение ----------

export function RegulationSection({ competition: c }: { competition: PublicCompetition }) {
  const t = useTranslations('tournamentPage.regulation');
  // Сформированное положение (PDF платформы) — поле появится в контракте вместе с генератором положения.
  const pdf =
    (c as PublicCompetition & { regulationPdfUrl?: string | null }).regulationPdfUrl ?? c.regulationUrl;
  if (!pdf) return <Placeholder icon="📄" title={t('tbdTitle')} text={t('tbdText')} />;
  const sameOrigin = pdf.startsWith('/');
  const download = sameOrigin ? `${pdf}${pdf.includes('?') ? '&' : '?'}download=1` : pdf;
  return (
    <Box>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <div className="flex flex-wrap gap-2">
          <a
            href={download}
            download={sameOrigin ? undefined : `${c.slug}-polozhenie.pdf`}
            className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
          >
            <DownloadIcon className="mr-2" />
            {t('download')}
          </a>
          <ShareButton
            title={t('shareTitle', { name: c.name })}
            path={`/tournaments/${c.slug}#regulation`}
            label={t('share')}
          />
        </div>
      </div>
      <iframe
        src={pdf}
        title={t('viewer', { name: c.name })}
        className="h-[75vh] min-h-[480px] w-full rounded-lg border border-slate-200 bg-slate-50"
      />
      <p className="mt-2 text-xs text-slate-500">
        {t('notShown')}{' '}
        <a href={pdf} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
          {t('openTab')}
        </a>
      </p>
    </Box>
  );
}

// ---------- Регистрация ----------

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}

function FollowButton({ viewer }: { viewer: Competition }) {
  const t = useTranslations('tournamentPage.registration');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const toggle = async (follow: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/competitions/${viewer.id}/follow`, { method: 'PUT', body: { follow } });
      await queryClient.invalidateQueries({ queryKey: ['competitions', 'slug', viewer.slug] });
      // Push — по желанию: браузер спросит разрешение; отказ не мешает подписке (лента и почта остаются).
      if (follow && me && pushSupport() === 'supported' && !(await currentSubscription())) {
        try {
          const cfg = await pushConfig();
          if (cfg.enabled && cfg.publicKey) {
            await enablePush(me.id, cfg.publicKey);
            setPushNote(t('pushOn'));
          }
        } catch {
          setPushNote(t('pushOff'));
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4">
      {error ? (
        <Alert tone="danger" className="mb-2">
          {error}
        </Alert>
      ) : null}
      {viewer.followed ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-sm text-green-900">
            <span aria-hidden="true">🔔</span>
            {t('followed')}
          </span>
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void toggle(false)}>
            {t('unfollow')}
          </Button>
        </div>
      ) : (
        <Button loading={busy} onClick={() => void toggle(true)}>
          <span aria-hidden="true" className="mr-2">
            🔔
          </span>
          {t('follow')}
        </Button>
      )}
      {pushNote ? <p className="mt-2 text-xs text-slate-600">{pushNote}</p> : null}
      <p className="mt-2 text-xs text-slate-500">{t('followHint')}</p>
    </div>
  );
}

export function RegistrationSection({
  competition: c,
  labels,
}: {
  competition: PublicCompetition;
  labels: TournamentLabels;
}) {
  const t = useTranslations('tournamentPage.registration');
  const pathname = usePathname();
  const viewer = useViewerCompetition(c.slug);
  const stage = stageOfCompetition(c.status);
  const from = labels.registrationFrom;
  const to = labels.registrationTo;
  const login = (
    <Link
      href={{ pathname: '/login', query: { next: pathname } }}
      className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 font-medium text-white hover:bg-blue-800"
    >
      {t('loginToFollow')}
    </Link>
  );
  if (stage === 'PUBLISHED')
    return (
      <Box>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-blue-50 text-blue-900">
            <span className="text-3xl font-black leading-none">{daysUntil(c.registrationStartsAt)}</span>
            <span className="text-[11px]">{t('daysLeft')}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold">{t('soonTitle')}</h3>
            <p className="mt-1 text-sm text-slate-700">{t('window', { from, to })}</p>
            <p className="mt-1 text-sm text-slate-600">{t('whoCan')}</p>
          </div>
        </div>
        {viewer.data ? <FollowButton viewer={viewer.data} /> : viewer.isPending ? null : login}
      </Box>
    );
  if (stage === 'REGISTRATION') {
    const canApply = viewer.data?.registrationOpenNow;
    return (
      <Box>
        <div className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden="true"
            className="stage-pulse flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl"
          >
            ✅
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-green-900">{t('openTitle')}</h3>
            <p className="mt-1 text-sm text-slate-700">{t('openUntil', { to })}</p>
          </div>
        </div>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((s, i) => (
            <li key={s} className="rounded-lg bg-slate-50 p-3 text-sm">
              <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">
                {i + 1}
              </span>
              {t(s)}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-600">{t('whoCan')}</p>
        {canApply && viewer.data ? (
          <Link
            href={`/competitions/${viewer.data.id}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
          >
            {t('apply')}
          </Link>
        ) : viewer.data || viewer.isPending ? null : (
          <Link
            href={{ pathname: '/login', query: { next: pathname } }}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
          >
            {t('loginToApply')}
          </Link>
        )}
      </Box>
    );
  }
  return <Placeholder icon="🔒" title={t('closedTitle')} text={t('closedText', { from, to })} />;
}
