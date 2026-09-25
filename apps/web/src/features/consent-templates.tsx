'use client';
// Тексты согласий (ФЗ-152; API.md, 4.2): черновик → публикация. Опубликованный текст неизменен —
// согласие ссылается на версию, которую человек видел. Новая редакция — новая версия.
import { CONSENT_KINDS, type ConsentKind, type ConsentTemplateDto, type DataEnvelope } from '@sde/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { fieldErrors } from '@/components/person-fields';
import { api } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

const TONE = { DRAFT: 'warning', PUBLISHED: 'success', RETIRED: 'neutral' } as const;

export function ConsentTemplates() {
  const t = useTranslations();
  const locale = useLocale();
  const [editing, setEditing] = useState<ConsentTemplateDto | 'new' | null>(null);
  const list = useQuery({
    queryKey: qk.consentTemplates({ admin: true }),
    queryFn: async () => (await api<DataEnvelope<ConsentTemplateDto[]>>('/admin/consent-templates')).data,
  });
  return (
    <>
      <PageHeader
        title={t('consentTemplates.title')}
        description={t('consentTemplates.hint')}
        actions={<Button onClick={() => setEditing('new')}>{t('consentTemplates.create')}</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <QueryState isPending={list.isPending} error={list.error}>
          {() =>
            (list.data ?? []).length === 0 ? (
              <EmptyState title={t('common.noData')} />
            ) : (
              <ul className="space-y-2">
                {(list.data ?? []).map((tpl) => (
                  <li key={tpl.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`consents.kinds.${tpl.kind}`)}</span>
                      <span>v{tpl.version}</span>
                      <span className="uppercase text-slate-500">{tpl.locale}</span>
                      <Badge tone={TONE[tpl.status]}>{t(`rulesets.statuses.${tpl.status}`)}</Badge>
                    </div>
                    <p className="text-slate-600">
                      {tpl.operatorName}
                      {tpl.publishedAt ? ` · ${formatDateTime(tpl.publishedAt, locale)}` : ''}
                    </p>
                    <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditing(tpl)}>
                      {tpl.status === 'DRAFT' ? t('common.edit') : t('common.details')}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
        {editing ? (
          <TemplateForm
            key={editing === 'new' ? 'new' : editing.id}
            template={editing === 'new' ? null : editing}
            onDone={(tpl) => setEditing(tpl)}
          />
        ) : null}
      </div>
    </>
  );
}

function TemplateForm({
  template,
  onDone,
}: {
  template: ConsentTemplateDto | null;
  onDone: (t: ConsentTemplateDto | null) => void;
}) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ConsentKind>(template?.kind ?? 'PD_PROCESSING');
  const [lang, setLang] = useState<'ru' | 'en'>(template?.locale ?? 'ru');
  const [operatorName, setOperatorName] = useState(template?.operatorName ?? '');
  const [body, setBody] = useState(template?.bodyMarkdown ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const readOnly = template !== null && template.status !== 'DRAFT';
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['consent-templates'] });
  const save = async (): Promise<ConsentTemplateDto> => {
    setErrors({});
    try {
      const res = template
        ? await api<DataEnvelope<ConsentTemplateDto>>(`/admin/consent-templates/${template.id}`, {
            method: 'PATCH',
            body: { operatorName: operatorName.trim(), bodyMarkdown: body.trim() },
          })
        : await api<DataEnvelope<ConsentTemplateDto>>('/admin/consent-templates', {
            method: 'POST',
            body: { kind, locale: lang, operatorName: operatorName.trim(), bodyMarkdown: body.trim() },
          });
      await refresh();
      return res.data;
    } catch (e) {
      setErrors(fieldErrors(e));
      throw e;
    }
  };
  return (
    <Card>
      <CardTitle>
        {template
          ? `${t(`consents.kinds.${template.kind}`)} v${template.version}`
          : t('consentTemplates.create')}
      </CardTitle>
      <div className="space-y-3">
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {readOnly ? <Alert tone="info">{t('consentTemplates.immutable')}</Alert> : null}
        {!template ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ct-kind" label={t('consents.kind')}>
              <Select id="ct-kind" value={kind} onChange={(e) => setKind(e.target.value as ConsentKind)}>
                {CONSENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`consents.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ct-locale" label={t('account.locale')}>
              <Select id="ct-locale" value={lang} onChange={(e) => setLang(e.target.value as 'ru' | 'en')}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
        ) : null}
        <Field id="ct-operator" label={t('consentTemplates.operator')} error={tf(errors.operatorName)}>
          <Input
            id="ct-operator"
            value={operatorName}
            readOnly={readOnly}
            onChange={(e) => setOperatorName(e.target.value)}
          />
        </Field>
        <Field
          id="ct-body"
          label={t('consentTemplates.body')}
          hint={t('consentTemplates.bodyHint')}
          error={tf(errors.bodyMarkdown)}
        >
          <Textarea
            id="ct-body"
            value={body}
            readOnly={readOnly}
            className="min-h-[24rem]"
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={action.busy}
              onClick={() => void action.run(async () => onDone(await save()))}
            >
              {t('rulesets.saveDraft')}
            </Button>
            <Button
              loading={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const draft = await save();
                  const res = await api<DataEnvelope<ConsentTemplateDto>>(
                    `/admin/consent-templates/${draft.id}/publish`,
                    {
                      method: 'POST',
                    },
                  );
                  await refresh();
                  onDone(res.data);
                })
              }
            >
              {t('consentTemplates.publish')}
            </Button>
            <Button variant="ghost" onClick={() => onDone(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
