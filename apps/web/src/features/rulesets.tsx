'use client';
// Наборы правил (API.md, 4.5; ADR-09): версии с параметрами в JSON. Черновик правится, опубликованная
// версия неизменна (контрольная сумма); турнир закрепляет конкретную опубликованную версию.
import {
  type DataEnvelope,
  type RuleSetDto,
  type RuleSetVersionDto,
  SAMPLE_RULESET_PARAMETERS,
} from '@sde/contracts';
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
  Textarea,
} from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { QueryState } from '@/components/common';
import { fieldErrors } from '@/components/person-fields';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { OwnerAndDiscipline, ownerBody } from './owner-select';

const VERSION_TONE = { DRAFT: 'warning', PUBLISHED: 'success', RETIRED: 'neutral' } as const;

export function RuleSets() {
  const t = useTranslations();
  const [scope, setScope] = useState({ owner: '', discipline: 'SPORT_SAMBO' });
  const onScope = useCallback((v: { owner: string; discipline: string }) => setScope(v), []);
  const [selected, setSelected] = useState<string | null>(null);
  const params = {
    disciplineCode: scope.discipline,
    ...(scope.owner && scope.owner !== 'platform' ? { ownerOrganizationId: scope.owner } : {}),
  };
  const list = useQuery({
    queryKey: [...qk.rulesets, params],
    queryFn: async () => (await api<DataEnvelope<RuleSetDto[]>>('/rulesets', { query: params })).data,
    enabled: scope.owner !== '',
  });
  const rows = (list.data ?? []).filter((r) => (scope.owner === 'platform' ? r.owner === null : true));
  return (
    <>
      <PageHeader title={t('rulesets.title')} description={t('rulesets.hint')} />
      <OwnerAndDiscipline
        permission="ruleset.manage"
        owner={scope.owner}
        discipline={scope.discipline}
        onChange={onScope}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <QueryState isPending={list.isPending && scope.owner !== ''} error={list.error}>
            {() =>
              rows.length === 0 ? (
                <EmptyState title={t('common.noData')}>{t('rulesets.empty')}</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        aria-current={selected === r.id}
                        className={`w-full rounded-md border p-3 text-left text-sm hover:bg-slate-50 ${selected === r.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}
                      >
                        <span className="font-medium">{r.name}</span>{' '}
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                        <br />
                        <span className="text-slate-600">
                          {r.owner?.shortName ?? t('catalog.platform')} ·{' '}
                          {r.latestPublishedVersion
                            ? t('rulesets.published', { version: r.latestPublishedVersion })
                            : t('rulesets.notPublished')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
          {scope.owner ? (
            <RuleSetCreate owner={scope.owner} discipline={scope.discipline} onCreated={setSelected} />
          ) : null}
        </div>
        {selected ? <RuleSetEditor id={selected} /> : null}
      </div>
    </>
  );
}

function RuleSetCreate({
  owner,
  discipline,
  onCreated,
}: {
  owner: string;
  discipline: string;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const queryClient = useQueryClient();
  const [v, setV] = useState({ code: '', name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  return (
    <Card>
      <CardTitle>{t('rulesets.create')}</CardTitle>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          void action.run(async () => {
            try {
              const res = await api<DataEnvelope<RuleSetDto>>('/rulesets', {
                method: 'POST',
                body: {
                  code: v.code.trim().toUpperCase(),
                  name: v.name.trim(),
                  disciplineCode: discipline,
                  ...ownerBody(owner),
                },
              });
              setV({ code: '', name: '' });
              await queryClient.invalidateQueries({ queryKey: qk.rulesets });
              onCreated(res.data.id);
            } catch (err) {
              setErrors(fieldErrors(err));
              throw err;
            }
          });
        }}
      >
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Field id="rs-code" label={t('catalog.code')} hint={t('catalog.codeHint')} error={tf(errors.code)}>
          <Input id="rs-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        </Field>
        <Field id="rs-name" label={t('rulesets.name')} error={tf(errors.name)}>
          <Input id="rs-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          loading={action.busy}
          disabled={!v.code || v.name.trim().length < 2}
        >
          {t('rulesets.create')}
        </Button>
      </form>
    </Card>
  );
}

function RuleSetEditor({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const ruleset = useQuery({
    queryKey: qk.ruleset(id),
    queryFn: async () => (await api<DataEnvelope<RuleSetDto>>(`/rulesets/${id}`)).data,
  });
  const [version, setVersion] = useState<number | null>(null);
  const action = useAction();
  const data = ruleset.data;
  const versions = data?.versions ?? [];
  const latest = versions.reduce<number | null>(
    (m, x) => (m === null || x.version > m ? x.version : m),
    null,
  );
  useEffect(() => {
    setVersion(latest);
  }, [id, latest]);
  const editable = data?.allowedActions.includes('ruleset.manage') ?? false;
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: qk.rulesets }).then(() => undefined);

  return (
    <Card>
      <QueryState isPending={ruleset.isPending} error={ruleset.error}>
        {() => (
          <>
            <CardTitle>
              {data?.name} <span className="font-mono text-sm text-slate-500">{data?.code}</span>
            </CardTitle>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {versions.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setVersion(x.version)}
                  aria-pressed={version === x.version}
                  className={`rounded-md border px-3 py-1 text-sm ${version === x.version ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`}
                >
                  v{x.version}{' '}
                  <Badge tone={VERSION_TONE[x.status]}>{t(`rulesets.statuses.${x.status}`)}</Badge>
                </button>
              ))}
              {editable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const res = await api<DataEnvelope<RuleSetVersionDto>>(`/rulesets/${id}/versions`, {
                        method: 'POST',
                        body: latest ? { basedOnVersion: latest } : { parameters: SAMPLE_RULESET_PARAMETERS },
                      });
                      await refresh();
                      setVersion(res.data.version);
                    })
                  }
                >
                  {t('rulesets.newVersion')}
                </Button>
              ) : null}
            </div>
            {action.error ? (
              <Alert tone="danger" className="mb-4">
                {action.error}
              </Alert>
            ) : null}
            {version !== null ? (
              <VersionEditor
                rulesetId={id}
                version={version}
                editable={editable}
                onChanged={refresh}
                locale={locale}
              />
            ) : (
              <p className="text-sm text-slate-600">{t('rulesets.noVersions')}</p>
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
}

function VersionEditor({
  rulesetId,
  version,
  editable,
  onChanged,
  locale,
}: {
  rulesetId: string;
  version: number;
  editable: boolean;
  onChanged: () => Promise<void>;
  locale: string;
}) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const key = [...qk.ruleset(rulesetId), 'versions', version];
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api<DataEnvelope<RuleSetVersionDto>>(`/rulesets/${rulesetId}/versions/${version}`)).data,
  });
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<{ path: string; code: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (query.data) setText(JSON.stringify(query.data.parameters, null, 2));
  }, [query.data]);
  const v = query.data;
  const draft = v?.status === 'DRAFT' && editable;
  const run = (fn: () => Promise<void>): void => {
    setProblems([]);
    setSaved(false);
    void action.run(async () => {
      try {
        await fn();
      } catch (e) {
        if (e instanceof ApiError) setProblems(e.fields);
        throw e;
      }
    });
  };
  const fieldText = (code: string): string => (t.has(`fields.${code}`) ? t(`fields.${code}`) : code);
  return (
    <QueryState isPending={query.isPending} error={query.error}>
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {t('rulesets.schemaVersion', { version: v?.schemaVersion ?? 1 })}
            {v?.publishedAt ? ` · ${t('rulesets.publishedAt')} ${formatDateTime(v.publishedAt, locale)}` : ''}
            {v?.checksum ? (
              <>
                {' '}
                · SHA-256 <span className="break-all font-mono text-xs">{v.checksum}</span>
              </>
            ) : null}
          </p>
          {!draft ? <Alert tone="info">{t('rulesets.immutable')}</Alert> : null}
          {saved ? <Alert tone="success">{t('common.saved')}</Alert> : null}
          {action.error ? (
            <Alert tone="danger">
              {action.error}
              {problems.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={`${p.path}-${p.code}`}>
                      <span className="font-mono">{p.path}</span>: {fieldText(p.code)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          <Field id="rs-params" label={t('rulesets.parameters')} hint={t('rulesets.parametersHint')}>
            <Textarea
              id="rs-params"
              value={text}
              readOnly={!draft}
              spellCheck={false}
              className="min-h-[28rem] font-mono text-xs"
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {draft ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={action.busy}
                onClick={() =>
                  run(async () => {
                    let parameters: unknown;
                    try {
                      parameters = JSON.parse(text);
                    } catch {
                      throw new ApiError(
                        400,
                        'VALIDATION_FAILED',
                        { fields: [{ path: 'parameters', code: 'invalid_json' }] },
                        null,
                      );
                    }
                    await api(`/rulesets/${rulesetId}/versions/${version}`, {
                      method: 'PATCH',
                      body: { parameters },
                    });
                    await queryClient.invalidateQueries({ queryKey: key });
                    setSaved(true);
                  })
                }
              >
                {t('rulesets.saveDraft')}
              </Button>
              <Button
                loading={action.busy}
                onClick={() =>
                  run(async () => {
                    await api(`/rulesets/${rulesetId}/versions/${version}/publish`, { method: 'POST' });
                    await queryClient.invalidateQueries({ queryKey: key });
                    await onChanged();
                  })
                }
              >
                {t('rulesets.publish')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </QueryState>
  );
}
