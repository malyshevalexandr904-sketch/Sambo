'use client';
// Документы заявки (Phase 9a): какие нужны по сценарию, загрузка с индикатором, удаление, скачивание по временной
// ссылке (каждое скачивание — в журнал доступа). Файлы лежат в приватном хранилище.
import {
  type DataEnvelope,
  type DownloadUrl,
  type OnboardingDocumentDto,
  type OnboardingRequestDto,
  UPLOAD_POLICIES,
} from '@sde/contracts';
import { Alert, Badge, Button } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FilePicker } from '@/components/file-picker';
import { useDocumentTypeName } from '@/features/documents/shared';
import { Link } from '@/i18n/navigation';
import { api, uploadFile } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useOnboardingFieldMessage } from './shared';

const ACCEPT = UPLOAD_POLICIES.ONBOARDING_DOCUMENT.mimeTypes.join(',');
const MAX_MB = UPLOAD_POLICIES.ONBOARDING_DOCUMENT.maxSizeBytes / 1024 / 1024;

export function DocumentLink({ requestId, doc }: { requestId: string; doc: OnboardingDocumentDto }) {
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          setError(null);
          try {
            const res = await api<DataEnvelope<DownloadUrl>>(
              `/onboarding/requests/${requestId}/documents/${doc.id}/download-url`,
            );
            window.open(res.data.url, '_blank', 'noopener');
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        {t('documents.download')}
      </Button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </>
  );
}

/** Шаг 4 — документы: по правилу сценария — обязательные и необязательные. */
export function DocumentsStep({
  request: r,
  errors,
  onChanged,
}: {
  request: OnboardingRequestDto;
  errors: Record<string, string>;
  onChanged: (r: OnboardingRequestDto) => void;
}) {
  const t = useTranslations('onboarding');
  const typeName = useDocumentTypeName();
  const fm = useOnboardingFieldMessage();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (r.documentRules.length === 0) return <Alert tone="info">{t('documents.none')}</Alert>;

  const attach = async (typeCode: string, file: File): Promise<void> => {
    setError(null);
    if (!UPLOAD_POLICIES.ONBOARDING_DOCUMENT.mimeTypes.includes(file.type)) {
      setError(t('documents.wrongType'));
      return;
    }
    if (file.size > UPLOAD_POLICIES.ONBOARDING_DOCUMENT.maxSizeBytes) {
      setError(t('documents.tooLarge', { mb: MAX_MB }));
      return;
    }
    setBusy(typeCode);
    try {
      const stored = await uploadFile('ONBOARDING_DOCUMENT', file);
      const res = await api<DataEnvelope<OnboardingRequestDto>>(`/onboarding/requests/${r.id}/documents`, {
        method: 'POST',
        body: { typeCode, fileId: stored.id },
      });
      onChanged(res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (doc: OnboardingDocumentDto): Promise<void> => {
    setError(null);
    try {
      const res = await api<DataEnvelope<OnboardingRequestDto>>(
        `/onboarding/requests/${r.id}/documents/${doc.id}`,
        { method: 'DELETE' },
      );
      onChanged(res.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {t('documents.hint', { mb: MAX_MB })}{' '}
        <Link href="/documents-guide" target="_blank" className="font-medium text-blue-700 underline">
          {t('documents.guideLink')}
        </Link>
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="space-y-3">
        {r.documentRules.map((rule) => {
          const key = rule.typeCodes[0] ?? '';
          const attached = r.documents.filter((d) => rule.typeCodes.includes(d.typeCode));
          const fieldError = fm(errors[`documents.${key}`]);
          return (
            <li key={rule.typeCodes.join('|')} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{rule.typeCodes.map(typeName).join(t('documents.or'))}</span>
                <Badge tone={rule.required ? 'warning' : 'neutral'}>
                  {rule.required ? t('documents.required') : t('documents.optional')}
                </Badge>
                {attached.length > 0 ? <Badge tone="success">✓ {t('documents.attached')}</Badge> : null}
              </div>
              {rule.typeCodes.some((c) => t.has(`documents.typeHints.${c}`)) ? (
                <p className="mt-1 text-sm text-slate-600">
                  {rule.typeCodes
                    .filter((c) => t.has(`documents.typeHints.${c}`))
                    .map((c) => t(`documents.typeHints.${c}`))
                    .join(' ')}
                </p>
              ) : null}
              {attached.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {attached.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span className="break-all">{d.fileName}</span>
                      <DocumentLink requestId={r.id} doc={d} />
                      <Button variant="ghost" size="sm" onClick={() => void remove(d)}>
                        {t('documents.remove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {rule.typeCodes.map((code) => (
                  <FilePicker
                    key={code}
                    label={
                      rule.typeCodes.length > 1
                        ? t('documents.uploadType', { type: typeName(code) })
                        : t('documents.upload')
                    }
                    accept={ACCEPT}
                    busy={busy === code}
                    onFile={(file) => void attach(code, file)}
                  />
                ))}
              </div>
              {busy && rule.typeCodes.includes(busy) ? (
                <p className="mt-2 text-sm text-slate-600" aria-live="polite">
                  {t('documents.uploading')}
                </p>
              ) : null}
              {fieldError ? (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {fieldError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
