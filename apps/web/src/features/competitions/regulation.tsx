'use client';
// Положение турнира (раздел 12 ТЗ): PDF, текст требований, обязательные документы и согласия, правила допуска
// к категориям. Требования меняются до закрытия регистрации: заявки проверяются по известным правилам.
import {
  type CategoryRuleDto,
  type CategoryRuleInput,
  CONSENT_KINDS,
  type Competition,
  type DataEnvelope,
  type RequirementDto,
  type RequirementInput,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { QueryState } from '@/components/common';
import { FilePicker } from '@/components/file-picker';
import { MarkdownLite } from '@/components/markdown-lite';
import { api, uploadFile } from '@/lib/api';
import { pickName, qk, useDocumentTypes, useSportRanks } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

const EDITABLE = ['DRAFT', 'REGISTRATION_OPEN'];

export function RegulationTab({ competition: c }: { competition: Competition }) {
  const canEdit = c.allowedActions.includes('competition.update');
  const canManage = c.allowedActions.includes('competition_category.manage') && EDITABLE.includes(c.status);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <RegulationCard competition={c} editable={canEdit} />
      <RequirementsCard competition={c} editable={canManage} />
      <RulesCard competition={c} editable={canManage} />
    </div>
  );
}

function RegulationCard({ competition: c, editable }: { competition: Competition; editable: boolean }) {
  const t = useTranslations('competitions.regulation');
  const queryClient = useQueryClient();
  const action = useAction();
  const [text, setText] = useState(c.requirementsMd ?? '');
  useEffect(() => setText(c.requirementsMd ?? ''), [c.requirementsMd]);
  const save = (body: { regulationFileId?: string | null; requirementsMd: string }): void =>
    void action.run(async () => {
      const res = await api<DataEnvelope<Competition>>(`/competitions/${c.id}/regulation`, {
        method: 'PUT',
        body,
        version: c.version,
      });
      queryClient.setQueryData(qk.competition(c.id), res.data);
    });
  return (
    <Card className="xl:col-span-2">
      <CardTitle>{t('title')}</CardTitle>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {c.regulation?.url ? (
          <a
            href={c.regulation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-700 hover:underline"
          >
            {t('open', { name: c.regulation.fileName })}
          </a>
        ) : (
          <span className="text-sm text-slate-600">{t('noFile')}</span>
        )}
        {editable ? (
          <FilePicker
            label={c.regulation ? t('replace') : t('upload')}
            accept="application/pdf"
            busy={action.busy}
            onFile={(file) =>
              void action.run(async () => {
                const stored = await uploadFile('REGULATION', file);
                const res = await api<DataEnvelope<Competition>>(`/competitions/${c.id}/regulation`, {
                  method: 'PUT',
                  body: { regulationFileId: stored.id, requirementsMd: text },
                  version: c.version,
                });
                queryClient.setQueryData(qk.competition(c.id), res.data);
              })
            }
          />
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">{t('pdfHint')}</p>
      {editable ? (
        <div className="mt-4 space-y-3">
          <Field id="reg-text" label={t('text')} hint={t('textHint')}>
            <Textarea
              id="reg-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={20000}
            />
          </Field>
          <Button loading={action.busy} onClick={() => save({ requirementsMd: text })}>
            {t('save')}
          </Button>
        </div>
      ) : c.requirementsMd ? (
        <MarkdownLite text={c.requirementsMd} className="prose-sm mt-4 space-y-2" />
      ) : null}
    </Card>
  );
}

interface RequirementChoice {
  key: string;
  input: RequirementInput;
  label: string;
}

function RequirementsCard({ competition: c, editable }: { competition: Competition; editable: boolean }) {
  const t = useTranslations('competitions.requirements');
  const tc = useTranslations('consents.kinds');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const docTypes = useDocumentTypes();
  const action = useAction();
  const list = useQuery({
    queryKey: qk.competitionRequirements(c.id),
    queryFn: async () =>
      (await api<DataEnvelope<RequirementDto[]>>(`/competitions/${c.id}/requirements`)).data,
  });
  const keyOf = (r: {
    kind: string;
    documentTypeCode?: string | null;
    consentKind?: string | null;
  }): string => `${r.kind}:${r.documentTypeCode ?? ''}:${r.consentKind ?? ''}`;
  const choices: RequirementChoice[] = [
    ...(docTypes.data ?? [])
      .filter((d) => d.code !== 'INSURANCE_POLICY')
      .map((d) => ({
        key: `DOCUMENT:${d.code}:`,
        input: { kind: 'DOCUMENT' as const, documentTypeCode: d.code, mandatory: true },
        label: t('document', { name: pickName(d.name, locale) }),
      })),
    {
      key: 'INSURANCE:INSURANCE_POLICY:',
      input: { kind: 'INSURANCE', documentTypeCode: 'INSURANCE_POLICY', mandatory: true },
      label: t('INSURANCE'),
    },
    ...CONSENT_KINDS.map((k) => ({
      key: `CONSENT::${k}`,
      input: { kind: 'CONSENT' as const, consentKind: k, mandatory: true },
      label: t('consent', { kind: tc(k) }),
    })),
    {
      key: 'MEDICAL_CLEARANCE::',
      input: { kind: 'MEDICAL_CLEARANCE', mandatory: true },
      label: t('MEDICAL_CLEARANCE'),
    },
    { key: 'WEIGH_IN::', input: { kind: 'WEIGH_IN', mandatory: true }, label: t('WEIGH_IN') },
    { key: 'CHECK_IN::', input: { kind: 'CHECK_IN', mandatory: true }, label: t('CHECK_IN') },
  ];
  const current = new Set((list.data ?? []).filter((r) => r.categoryId === null).map(keyOf));
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ?? current;
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <QueryState isPending={list.isPending || docTypes.isPending} error={list.error}>
        {() => (
          <>
            <ul className="space-y-2">
              {choices
                .filter((ch) => editable || chosen.has(ch.key))
                .map((ch) => (
                  <li key={ch.key}>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={chosen.has(ch.key)}
                        disabled={!editable}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(ch.key);
                          else next.delete(ch.key);
                          setSelected(next);
                        }}
                      />
                      {ch.label}
                    </label>
                  </li>
                ))}
            </ul>
            {!editable && chosen.size === 0 ? <p className="text-sm text-slate-600">{t('none')}</p> : null}
            {editable ? (
              <Button
                className="mt-3"
                loading={action.busy}
                disabled={selected === null}
                onClick={() =>
                  void action.run(async () => {
                    const perCategory = (list.data ?? []).filter((r) => r.categoryId !== null);
                    const requirements = [
                      ...choices.filter((ch) => chosen.has(ch.key)).map((ch) => ch.input),
                      ...perCategory.map((r) => ({
                        categoryId: r.categoryId,
                        kind: r.kind,
                        documentTypeCode: r.documentTypeCode,
                        consentKind: r.consentKind,
                        mandatory: r.mandatory,
                        noteMd: r.noteMd,
                      })),
                    ];
                    await api(`/competitions/${c.id}/requirements`, {
                      method: 'PUT',
                      body: { requirements },
                    });
                    setSelected(null);
                    await queryClient.invalidateQueries({ queryKey: qk.competitionRequirements(c.id) });
                  })
                }
              >
                {t('save')}
              </Button>
            ) : null}
          </>
        )}
      </QueryState>
    </Card>
  );
}

function RulesCard({ competition: c, editable }: { competition: Competition; editable: boolean }) {
  const t = useTranslations('competitions.rules');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const ranks = useSportRanks();
  const action = useAction();
  const list = useQuery({
    queryKey: qk.competitionRules(c.id),
    queryFn: async () =>
      (await api<DataEnvelope<CategoryRuleDto[]>>(`/competitions/${c.id}/category-rules`)).data,
  });
  /** Параметр общего правила турнира (без категории) строкой для поля формы. */
  const param = (kind: string, key: string): string => {
    const v = (list.data ?? []).find((r) => r.kind === kind && r.categoryId === null)?.params[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  };
  const [form, setForm] = useState<{ max: string; younger: string; minRank: string } | null>(null);
  const value = form ?? {
    max: param('MAX_CATEGORIES_PER_ATHLETE', 'max'),
    younger: param('ALLOW_YOUNGER', 'years'),
    minRank: param('MIN_RANK', 'sportRankCode'),
  };
  const set = (k: keyof typeof value) => (e: { target: { value: string } }) =>
    setForm({ ...value, [k]: e.target.value });
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      <QueryState isPending={list.isPending} error={list.error}>
        {() => (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                const keep = (list.data ?? []).filter(
                  (r) =>
                    r.categoryId !== null ||
                    !['MAX_CATEGORIES_PER_ATHLETE', 'ALLOW_YOUNGER', 'MIN_RANK'].includes(r.kind),
                );
                const rules: CategoryRuleInput[] = keep.map((r) => ({
                  categoryId: r.categoryId,
                  kind: r.kind,
                  params: r.params,
                }));
                if (value.max)
                  rules.push({ kind: 'MAX_CATEGORIES_PER_ATHLETE', params: { max: Number(value.max) } });
                if (value.younger && value.younger !== '0')
                  rules.push({ kind: 'ALLOW_YOUNGER', params: { years: Number(value.younger) } });
                if (value.minRank) rules.push({ kind: 'MIN_RANK', params: { sportRankCode: value.minRank } });
                await api(`/competitions/${c.id}/category-rules`, { method: 'PUT', body: { rules } });
                setForm(null);
                await queryClient.invalidateQueries({ queryKey: qk.competitionRules(c.id) });
              });
            }}
          >
            <Field id="r-max" label={t('maxCategories')} hint={t('maxCategoriesHint')}>
              <Input
                id="r-max"
                type="number"
                min={1}
                max={10}
                value={value.max}
                onChange={set('max')}
                disabled={!editable}
              />
            </Field>
            <Field id="r-younger" label={t('allowYounger')} hint={t('allowYoungerHint')}>
              <Select
                id="r-younger"
                value={value.younger || '0'}
                onChange={set('younger')}
                disabled={!editable}
              >
                {['0', '1', '2', '3'].map((y) => (
                  <option key={y} value={y}>
                    {y === '0' ? t('no') : t('years', { count: Number(y) })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="r-rank" label={t('minRank')}>
              <Select id="r-rank" value={value.minRank} onChange={set('minRank')} disabled={!editable}>
                <option value="">{t('noMinRank')}</option>
                {(ranks.data ?? []).map((r) => (
                  <option key={r.code} value={r.code}>
                    {pickName(r.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            {editable ? (
              <Button type="submit" loading={action.busy} disabled={form === null}>
                {t('save')}
              </Button>
            ) : null}
          </form>
        )}
      </QueryState>
    </Card>
  );
}
