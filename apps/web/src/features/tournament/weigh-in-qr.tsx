'use client';
// QR для взвешивания в личном кабинете спортсмена и представителя (правки 05.11.2026): на мандатной комиссии и
// взвешивании турнира кабинет сразу показывает QR участия — судья сканирует его и записывает вес.
import { type AthleteEntryDto, type DataEnvelope, type EntryQrDto } from '@sde/contracts';
import { Alert, Card, CardTitle } from '@sde/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { pickName, useMyAthletes } from '@/lib/queries';

/** Мандатная комиссия (QR пригодится) и взвешивание (QR нужен сейчас). */
const QR_STATUSES: readonly string[] = ['REGISTRATION_CLOSED', 'CHECK_IN'];

function QrImage({ entry }: { entry: AthleteEntryDto }) {
  const t = useTranslations('stages.qr');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const qr = useQuery({
    queryKey: ['entries', entry.id, 'qr'],
    queryFn: async () => (await api<DataEnvelope<EntryQrDto>>(`/entries/${entry.id}/qr`)).data,
    staleTime: 10 * 60_000,
  });
  const now = entry.competition.status === 'CHECK_IN';
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 p-4 text-center sm:flex-row sm:text-left">
      {qr.data ? (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.data.svg)}`}
          alt={t('alt', { name: qr.data.athlete.publicName })}
          className="h-52 w-52 shrink-0 rounded-lg bg-white p-2"
        />
      ) : (
        <div className="h-52 w-52 shrink-0 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="font-semibold">{entry.competition.name}</p>
        <p className="text-sm text-slate-700">
          {entry.publicName} · {pickName(entry.category.name, locale)}
        </p>
        <p className={now ? 'mt-2 font-medium text-green-800' : 'mt-2 text-sm text-slate-600'}>
          {now ? t('now') : t('soon')}
        </p>
        {qr.data ? (
          <p className="mt-1 text-xs text-slate-500">
            {t('validUntil', { date: formatDateTime(qr.data.expiresAt, locale) })}
          </p>
        ) : null}
        {qr.error ? (
          <Alert tone="danger" className="mt-2">
            {errorMessage(qr.error)}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

export function MyWeighInQr() {
  const t = useTranslations('stages.qr');
  const mine = useMyAthletes();
  const athletes = (mine.data ?? []).filter((a) => a.relation === 'SELF' || a.verified);
  const lists = useQueries({
    queries: athletes.map((a) => ({
      queryKey: ['athletes', a.athleteId, 'entries'],
      queryFn: async () =>
        (await api<DataEnvelope<AthleteEntryDto[]>>(`/athletes/${a.athleteId}/entries`)).data,
      staleTime: 60_000,
    })),
  });
  const entries = lists
    .flatMap((q) => q.data ?? [])
    .filter((e) => e.status === 'APPROVED' && QR_STATUSES.includes(e.competition.status));
  if (entries.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardTitle>{t('title')}</CardTitle>
      <p className="-mt-2 mb-3 text-sm text-slate-600">{t('hint')}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map((e) => (
          <QrImage key={e.id} entry={e} />
        ))}
      </div>
    </Card>
  );
}
