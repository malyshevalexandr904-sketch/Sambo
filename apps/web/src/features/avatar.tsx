'use client';
// Фото профиля в личном кабинете: загрузка как у логотипа (presigned POST в хранилище, проверка на сервере), затем
// привязка к своей записи «человек» (PUT /me/avatar).
import {
  type DataEnvelope,
  type Me,
  type StoredFileDto,
  UPLOAD_POLICIES,
  type UploadTicket,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, cn, Spinner } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api, sha256Hex, uploadToStorage } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';

const POLICY = UPLOAD_POLICIES.AVATAR;
const MAX_MB = POLICY.maxSizeBytes / 1024 / 1024;

/** Круглое фото или инициалы, если фото нет. */
export function Avatar({
  me,
  size = 'md',
}: {
  me: Pick<Me, 'avatarUrl' | 'displayName'>;
  size?: 'md' | 'lg';
}) {
  const initials = me.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-800',
        size === 'lg' ? 'h-24 w-24 text-2xl' : 'h-10 w-10 text-sm',
      )}
      aria-hidden="true"
    >
      {me.avatarUrl ? <img src={me.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
    </span>
  );
}

export function AvatarCard({ me }: { me: Me }) {
  const t = useTranslations('account.avatar');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (fileId: string | null): Promise<void> => {
    const res = await api<DataEnvelope<Me>>('/me/avatar', { method: 'PUT', body: { fileId } });
    queryClient.setQueryData(qk.me, res.data);
  };

  const upload = async (file: File): Promise<void> => {
    setFailure(null);
    if (!POLICY.mimeTypes.includes(file.type)) {
      setFailure(t('wrongType'));
      return;
    }
    if (file.size > POLICY.maxSizeBytes) {
      setFailure(t('tooLarge', { mb: MAX_MB }));
      return;
    }
    setBusy(true);
    try {
      const ticket = await api<DataEnvelope<UploadTicket>>('/files/uploads', {
        method: 'POST',
        body: {
          purpose: 'AVATAR',
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
      await save(done.data.id);
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setFailure(null);
    setBusy(true);
    try {
      await save(null);
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      {me.personId ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar me={me} size="lg" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor={inputId}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
              >
                {busy ? <Spinner className="h-4 w-4" /> : null}
                {me.avatarUrl ? t('change') : t('upload')}
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
              {me.avatarUrl ? (
                <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                  {t('remove')}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-slate-500">{t('hint', { mb: MAX_MB })}</p>
            {failure ? <Alert tone="danger">{failure}</Alert> : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t('needPerson')}</p>
      )}
    </Card>
  );
}
