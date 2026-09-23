'use client';
// Загрузка логотипа: presigned POST прямо в хранилище, затем проверка на сервере (ADR-14; API.md, 3.5).
import { type DataEnvelope, type StoredFileDto, UPLOAD_POLICIES, type UploadTicket } from '@sde/contracts';
import { Alert, Spinner } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api, sha256Hex, uploadToStorage } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';

const POLICY = UPLOAD_POLICIES.ORGANIZATION_LOGO;

export function LogoUpload({
  currentUrl,
  error,
  onUploaded,
}: {
  currentUrl: string | null;
  error?: string;
  onUploaded: (fileId: string) => void;
}) {
  const t = useTranslations('organizations');
  const errorMessage = useErrorMessage();
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const ticket = await api<DataEnvelope<UploadTicket>>('/files/uploads', {
        method: 'POST',
        body: {
          purpose: 'ORGANIZATION_LOGO',
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          sha256: await sha256Hex(file),
        },
      });
      await uploadToStorage(ticket.data.uploadUrl, ticket.data.fields, file);
      const done = await api<DataEnvelope<StoredFileDto>>(`/files/${ticket.data.fileId}/complete`, {
        method: 'POST',
      });
      setPreview(done.data.publicUrl);
      onUploaded(done.data.id);
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        {preview ? (
          <img src={preview} alt={t('logo')} className="h-full w-full object-contain" />
        ) : (
          <span aria-hidden="true">—</span>
        )}
      </div>
      <div className="space-y-1">
        <label
          htmlFor={inputId}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {t('uploadLogo')}
        </label>
        <input
          id={inputId}
          type="file"
          accept={POLICY.mimeTypes.join(',')}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-slate-500">{t('logoHint')}</p>
        {failure || error ? <Alert tone="danger">{failure ?? error}</Alert> : null}
      </div>
    </div>
  );
}
