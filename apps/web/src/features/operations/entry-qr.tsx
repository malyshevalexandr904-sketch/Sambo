'use client';
// QR участника для тренера, представителя и самого спортсмена (API.md, 5.5): подписанный токен без ПДн,
// SVG строит сервер. Показывается картинкой — разметка SVG в страницу не вставляется.
import type { DataEnvelope, EntryQrDto } from '@sde/contracts';
import { Alert, Button } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { pickName } from '@/lib/queries';

export function EntryQr({ entryId }: { entryId: string }) {
  const t = useTranslations('checkin');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const qr = useQuery({
    queryKey: ['entries', entryId, 'qr'],
    queryFn: async () => (await api<DataEnvelope<EntryQrDto>>(`/entries/${entryId}/qr`)).data,
    enabled: open,
    staleTime: 10 * 60_000,
  });
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('showQr')}
      </Button>
    );
  return (
    <div className="w-full space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <p className="font-medium">{t('qrTitle')}</p>
      {qr.error ? <Alert tone="danger">{errorMessage(qr.error)}</Alert> : null}
      {qr.data ? (
        <>
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.data.svg)}`}
            alt={t('qrTitle')}
            className="h-56 w-56"
          />
          <p className="text-sm">
            {qr.data.athlete.publicName} ·{' '}
            {qr.data.categories.map((c) => pickName(c.name, locale)).join(', ')}
          </p>
          <p className="text-xs text-slate-600">{t('qrHint')}</p>
          <p className="text-xs text-slate-600">
            {t('qrValidUntil', { date: formatDateTime(qr.data.expiresAt, locale) })}
          </p>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t('hideQr')}
      </Button>
    </div>
  );
}
