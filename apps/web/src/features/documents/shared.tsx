'use client';
// Строка документа: статус, скачивание по временной ссылке (с записью в журнал доступа), проверка, удаление.
import { type DataEnvelope, type DocumentDto, type DocumentStatus, type DownloadUrl } from '@sde/contracts';
import { Alert, Badge, Button } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { pickName, useDocumentTypes } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

const TONE: Record<DocumentStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  UPLOADED: 'info',
  UNDER_REVIEW: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
};
const ICON: Record<DocumentStatus, string> = {
  UPLOADED: '◆',
  UNDER_REVIEW: '◐',
  VERIFIED: '●',
  REJECTED: '■',
  EXPIRED: '○',
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const t = useTranslations('documents.statuses');
  return (
    <Badge tone={TONE[status]}>
      <span aria-hidden="true">{ICON[status]}</span>
      {t(status)}
    </Badge>
  );
}

export function useDocumentTypeName(): (code: string) => string {
  const locale = useLocale();
  const types = useDocumentTypes();
  return (code) => {
    const type = types.data?.find((x) => x.code === code);
    return type ? pickName(type.name, locale) : code;
  };
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DocumentItem({
  doc,
  showOwner = false,
  onChanged,
}: {
  doc: DocumentDto;
  showOwner?: boolean;
  onChanged: (doc: DocumentDto | null) => void | Promise<void>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const typeName = useDocumentTypeName();
  const action = useAction();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const can = (a: string): boolean => doc.allowedActions.includes(a);
  const transition = async (to: 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED', reason?: string): Promise<void> => {
    const res = await api<DataEnvelope<DocumentDto>>(`/documents/${doc.id}/transitions`, {
      method: 'POST',
      version: doc.version,
      body: reason ? { to, reason } : { to },
    });
    await onChanged(res.data);
  };
  const reviewable = can('document.verify') && (doc.status === 'UPLOADED' || doc.status === 'UNDER_REVIEW');
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{typeName(doc.typeCode)}</span>
        <DocumentStatusBadge status={doc.status} />
        {showOwner && doc.owner.type !== 'APPLICATION' ? (
          <span className="text-slate-700">{doc.owner.name}</span>
        ) : null}
      </div>
      <p className="mt-1 text-slate-600">
        {doc.file.originalName} · {formatSize(doc.file.sizeBytes)} · {t('documents.uploaded')}{' '}
        {formatDateTime(doc.uploadedAt, locale)}
        {doc.uploadedBy ? ` · ${doc.uploadedBy.displayName}` : ''}
        {doc.expirationDate
          ? ` · ${t('documents.validUntil')} ${formatDate(doc.expirationDate, locale)}`
          : ''}
      </p>
      {doc.reviewedAt ? (
        <p className="text-slate-600">
          {t('documents.reviewed')} {formatDateTime(doc.reviewedAt, locale)}
          {doc.reviewedBy ? ` · ${doc.reviewedBy.displayName}` : ''}
          {doc.rejectReason ? ` · ${t('documents.rejectReason')}: ${doc.rejectReason}` : ''}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setDownloadError(null);
            // Окно открывается сразу (иначе браузер заблокирует всплывающее окно), адрес подставляется после ответа.
            const win = window.open('about:blank', '_blank');
            if (win) win.opener = null;
            api<DataEnvelope<DownloadUrl>>(`/documents/${doc.id}/download-url`)
              .then((res) => {
                if (win) win.location.href = res.data.url;
                else window.location.href = res.data.url;
              })
              .catch(() => {
                win?.close();
                setDownloadError(t('documents.downloadFailed'));
              });
          }}
        >
          {t('documents.download')}
        </Button>
        {reviewable && doc.status === 'UPLOADED' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={action.busy}
            onClick={() => void action.run(() => transition('UNDER_REVIEW'))}
          >
            {t('documents.takeForReview')}
          </Button>
        ) : null}
        {reviewable ? (
          <Button
            size="sm"
            loading={action.busy}
            onClick={() => void action.run(() => transition('VERIFIED'))}
          >
            {t('documents.verify')}
          </Button>
        ) : null}
        {reviewable ? (
          <ReasonAction
            label={t('documents.reject')}
            title={t('documents.rejectTitle')}
            description={t('documents.rejectHint')}
            variant="danger"
            onConfirm={(reason) => transition('REJECTED', reason)}
          />
        ) : null}
        {can('document.delete') ? (
          <Button
            size="sm"
            variant="ghost"
            loading={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/documents/${doc.id}`, { method: 'DELETE' });
                await onChanged(null);
              })
            }
          >
            {t('documents.delete')}
          </Button>
        ) : null}
      </div>
      {action.error || downloadError ? (
        <Alert tone="danger" className="mt-2">
          {action.error ?? downloadError}
        </Alert>
      ) : null}
    </li>
  );
}
