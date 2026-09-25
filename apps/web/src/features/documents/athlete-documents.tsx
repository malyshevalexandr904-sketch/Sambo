'use client';
// Документы спортсмена на его карточке (API.md, 4.6): загрузка в приватное хранилище, статусы проверки.
import { type Athlete, type DocumentDto, type Page } from '@sde/contracts';
import { Alert, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FilePicker } from '@/components/file-picker';
import { fieldErrors } from '@/components/person-fields';
import { api, uploadFile } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName, qk, useDocumentTypes } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { DocumentItem } from './shared';

export function AthleteDocuments({ athlete }: { athlete: Athlete }) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const types = useDocumentTypes();
  const key = qk.documents({ athleteId: athlete.id });
  const docs = useQuery({
    queryKey: key,
    queryFn: () => api<Page<DocumentDto>>('/documents', { query: { athleteId: athlete.id, limit: 100 } }),
  });
  const [typeCode, setTypeCode] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [competitionId, setCompetitionId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upload = useAction();
  const canUpload = athlete.allowedActions.includes('document.upload');
  const uploadable = (types.data ?? []).filter((x) => x.code !== 'CONSENT_SCAN');
  const selected = uploadable.find((x) => x.code === typeCode);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['documents'] });

  return (
    <Card>
      <CardTitle>{t('documents.title')}</CardTitle>
      {canUpload ? (
        <div className="mb-4 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2">
          <Field id="doc-type" label={t('documents.type')} error={tf(errors.typeCode)}>
            <Select id="doc-type" value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
              <option value="">—</option>
              {uploadable.map((x) => (
                <option key={x.code} value={x.code}>
                  {pickName(x.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="doc-exp"
            label={t('documents.expirationDate')}
            hint={t('documents.expirationHint')}
            error={tf(errors.expirationDate)}
          >
            <Input
              id="doc-exp"
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
            />
          </Field>
          <Field
            id="doc-competition"
            label={t('documents.competition')}
            hint={t('documents.competitionHint')}
            error={tf(errors.competitionId)}
            className="sm:col-span-2"
          >
            <Input
              id="doc-competition"
              value={competitionId}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(e) => setCompetitionId(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            {selected ? (
              <FilePicker
                label={t('documents.upload')}
                accept={selected.allowedMime.join(',')}
                busy={upload.busy}
                onFile={(file) => {
                  setErrors({});
                  void upload.run(async () => {
                    try {
                      const stored = await uploadFile('DOCUMENT', file);
                      await api('/documents', {
                        method: 'POST',
                        body: {
                          typeCode,
                          fileId: stored.id,
                          owner: { athleteId: athlete.id },
                          ...(expirationDate ? { expirationDate } : {}),
                          ...(competitionId.trim() ? { competitionId: competitionId.trim() } : {}),
                        },
                      });
                      setTypeCode('');
                      setExpirationDate('');
                      await refresh();
                    } catch (err) {
                      setErrors(fieldErrors(err));
                      throw err;
                    }
                  });
                }}
              />
            ) : (
              <p className="text-sm text-slate-600">{t('documents.chooseType')}</p>
            )}
            {selected ? (
              <p className="mt-1 text-xs text-slate-500">
                {t('documents.limits', {
                  types: selected.allowedMime.join(', '),
                  size: Math.round(selected.maxSizeBytes / 1024 / 1024),
                })}
              </p>
            ) : null}
          </div>
          {upload.error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {upload.error}
            </Alert>
          ) : null}
        </div>
      ) : null}
      {docs.error ? <Alert tone="danger">{t('errors.UNKNOWN', { traceId: '—' })}</Alert> : null}
      <ul className="space-y-2">
        {(docs.data?.data ?? []).length === 0 && !docs.isPending ? (
          <li className="text-sm text-slate-600">{t('documents.none')}</li>
        ) : null}
        {(docs.data?.data ?? []).map((d) => (
          <DocumentItem key={d.id} doc={d} onChanged={refresh} />
        ))}
      </ul>
    </Card>
  );
}
