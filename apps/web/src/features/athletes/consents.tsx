'use client';
// Согласия спортсмена (API.md, 4.2; ФЗ-152). Электронное согласие даёт подтверждённый представитель
// или совершеннолетний спортсмен; бумажное (скан) вносит клуб или тренер.
import {
  type Athlete,
  CONSENT_KINDS,
  type ConsentDto,
  type ConsentKind,
  type ConsentTemplateDto,
  type DataEnvelope,
  type DocumentDto,
  isAdultOn,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { FilePicker } from '@/components/file-picker';
import { MarkdownLite } from '@/components/markdown-lite';
import { fieldErrors } from '@/components/person-fields';
import { api, uploadFile } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { refreshAthlete } from './guardians';

export function ConsentsPanel({ athlete }: { athlete: Athlete }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const can = (a: string): boolean => athlete.allowedActions.includes(a);
  const consents = useQuery({
    queryKey: qk.athleteConsents(athlete.id),
    queryFn: async () => (await api<DataEnvelope<ConsentDto[]>>(`/athletes/${athlete.id}/consents`)).data,
  });
  const templates = useQuery({
    queryKey: qk.consentTemplates({ locale }),
    queryFn: async () =>
      (await api<DataEnvelope<ConsentTemplateDto[]>>('/consent-templates', { query: { locale } })).data,
    enabled: can('consent.give') || can('consent.record'),
    staleTime: 5 * 60_000,
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.athleteConsents(athlete.id) });
    await refreshAthlete(queryClient, athlete.id);
    await queryClient.invalidateQueries({ queryKey: qk.myAthletes });
  };
  const active = (consents.data ?? []).filter((c) => c.active);
  const history = (consents.data ?? []).filter((c) => !c.active);
  const missing = CONSENT_KINDS.filter((k) => athlete.consentsStatus[k] === 'MISSING');

  return (
    <Card>
      <CardTitle>{t('consents.title')}</CardTitle>
      <ul className="mb-4 flex flex-wrap gap-2">
        {CONSENT_KINDS.map((k) => (
          <li key={k}>
            <Badge tone={athlete.consentsStatus[k] === 'GIVEN' ? 'success' : 'warning'}>
              <span aria-hidden="true">{athlete.consentsStatus[k] === 'GIVEN' ? '●' : '◐'}</span>
              {t(`consents.kinds.${k}`)}: {t(`consents.states.${athlete.consentsStatus[k]}`)}
            </Badge>
          </li>
        ))}
      </ul>
      {athlete.relation === 'GUARDIAN' && !can('consent.give') ? (
        <Alert tone="info" className="mb-4">
          {t('consents.guardianNotVerified')}
        </Alert>
      ) : null}
      {active.length > 0 ? (
        <ul className="mb-4 space-y-2 text-sm">
          {active.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t(`consents.kinds.${c.kind}`)}</span>
              <span className="text-slate-600">
                v{c.template.version} · {t(`consents.methods.${c.method}`)} · {c.givenBy.name} ·{' '}
                {formatDateTime(c.givenAt, locale)}
              </span>
              {can('consent.revoke') ? (
                <ReasonAction
                  label={t('consents.revoke')}
                  title={t('consents.revokeTitle')}
                  description={t('consents.revokeHint')}
                  size="sm"
                  required={false}
                  onConfirm={async (reason) => {
                    await api(`/consents/${c.id}/revoke`, { method: 'POST', body: reason ? { reason } : {} });
                    await refresh();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {can('consent.give')
        ? missing.map((kind) => {
            const template = templates.data?.find((x) => x.kind === kind);
            return template ? (
              <GiveConsent key={kind} athleteId={athlete.id} template={template} onDone={refresh} />
            ) : null;
          })
        : null}
      {can('consent.record') && missing.length > 0 ? (
        <PaperConsent athlete={athlete} kinds={missing} templates={templates.data ?? []} onDone={refresh} />
      ) : null}
      {history.length > 0 ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate-700">{t('consents.history')}</summary>
          <ul className="mt-2 space-y-1 text-slate-600">
            {history.map((c) => (
              <li key={c.id}>
                {t(`consents.kinds.${c.kind}`)} v{c.template.version} · {formatDateTime(c.givenAt, locale)} →{' '}
                {t('consents.revokedAt')} {formatDateTime(c.revokedAt, locale)}
                {c.revokeReason ? ` (${c.revokeReason})` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function GiveConsent({
  athleteId,
  template,
  onDone,
}: {
  athleteId: string;
  template: ConsentTemplateDto;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('consents');
  const [agreed, setAgreed] = useState(false);
  const action = useAction();
  const id = `consent-${template.kind}`;
  return (
    <div className="mb-4 rounded-md border border-slate-200 p-3">
      <p className="font-medium">
        {t(`kinds.${template.kind}`)} · {t('version', { version: template.version })}
      </p>
      <p className="text-sm text-slate-600">{t('operator', { name: template.operatorName })}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-blue-700">{t('readText')}</summary>
        <MarkdownLite
          text={template.bodyMarkdown}
          className="mt-2 max-h-72 overflow-y-auto rounded bg-slate-50 p-3 text-sm"
        />
      </details>
      <label htmlFor={id} className="mt-3 flex items-start gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        {t('agree')}
      </label>
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      <Button
        className="mt-3"
        disabled={!agreed}
        loading={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api(`/athletes/${athleteId}/consents`, {
              method: 'POST',
              body: { templateId: template.id, method: 'ELECTRONIC' },
            });
            await onDone();
          })
        }
      >
        {t('give')}
      </Button>
    </div>
  );
}

function PaperConsent({
  athlete,
  kinds,
  templates,
  onDone,
}: {
  athlete: Athlete;
  kinds: ConsentKind[];
  templates: ConsentTemplateDto[];
  onDone: () => Promise<void>;
}) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const minor = !isAdultOn(athlete.person.birthDate);
  const verified = athlete.guardians.filter((g) => g.verifiedAt);
  const [kind, setKind] = useState<ConsentKind>(kinds[0] ?? 'PD_PROCESSING');
  const [guardianId, setGuardianId] = useState(verified[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const action = useAction();
  const template = templates.find((x) => x.kind === kind);
  return (
    <div className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
      <p className="font-medium">{t('consents.paperTitle')}</p>
      <p className="mb-3 text-sm text-slate-600">{t('consents.paperHint')}</p>
      {done ? (
        <Alert tone="success" className="mb-3">
          {t('consents.paperDone')}
        </Alert>
      ) : null}
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="paper-kind" label={t('consents.kind')} error={tf(errors.templateId)}>
          <Select id="paper-kind" value={kind} onChange={(e) => setKind(e.target.value as ConsentKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`consents.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {minor ? (
          <Field id="paper-guardian" label={t('consents.signedBy')} error={tf(errors.guardianId)}>
            <Select id="paper-guardian" value={guardianId} onChange={(e) => setGuardianId(e.target.value)}>
              <option value="">—</option>
              {verified.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.lastName} {g.firstName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      {minor && verified.length === 0 ? (
        <p className="mt-2 text-sm text-amber-800">{t('consents.needVerifiedGuardian')}</p>
      ) : null}
      <div className="mt-3">
        <FilePicker
          label={t('consents.uploadScan')}
          accept="application/pdf,image/jpeg,image/png"
          busy={action.busy}
          onFile={(file) => {
            if (!template) return;
            setErrors({});
            setDone(false);
            void action.run(async () => {
              try {
                const stored = await uploadFile('CONSENT_SCAN', file);
                const doc = await api<DataEnvelope<DocumentDto>>('/documents', {
                  method: 'POST',
                  body: { typeCode: 'CONSENT_SCAN', fileId: stored.id, owner: { athleteId: athlete.id } },
                });
                await api(`/athletes/${athlete.id}/consents`, {
                  method: 'POST',
                  body: {
                    templateId: template.id,
                    method: 'PAPER_SCAN',
                    documentId: doc.data.id,
                    ...(minor && guardianId ? { guardianId } : {}),
                  },
                });
                setDone(true);
                await onDone();
              } catch (err) {
                setErrors(fieldErrors(err));
                throw err;
              }
            });
          }}
        />
      </div>
    </div>
  );
}
