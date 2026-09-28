'use client';
// Жеребьёвка категории: новый черновик (формат, разведение, посев, seed), версии и выбранная версия с сеткой.
import {
  type CategoryDrawsDto,
  type Competition,
  type DataEnvelope,
  DRAW_FORMATS,
  type DrawDto,
  type DrawFormat,
  isDrawFormat,
  SEPARATION_KEYS,
  type SeparationKey,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { CategoryStatusBadge } from '@/features/competitions/shared';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { pickName } from '@/lib/queries';
import { DrawView } from './draw-view';
import { DrawStatusBadge, useCommandError, useDraw, useFormatLabel, useInvalidateDraws } from './shared';

const SEED_RE = /^[0-9a-f]{32}$/;

function CreateDraft({
  data,
  onCreated,
}: {
  data: CategoryDrawsDto;
  onCreated: (draw: DrawDto) => Promise<void>;
}) {
  const t = useTranslations('draws.create');
  const formatLabel = useFormatLabel();
  const describe = useCommandError();
  const fieldMessage = useFieldMessage();
  const suggested = isDrawFormat(data.suggestedFormat) ? data.suggestedFormat : '';
  const [format, setFormat] = useState<DrawFormat | ''>(suggested);
  const [keys, setKeys] = useState<SeparationKey[]>(['ORGANIZATION', 'REGION']);
  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [randomSeed, setRandomSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seedInvalid = randomSeed !== '' && (!SEED_RE.test(randomSeed) || /^0+$/.test(randomSeed));
  const toggle = (key: SeparationKey): void =>
    setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : [...k, key]));
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const seeding = Object.entries(seeds)
        .filter(([, v]) => v.trim() !== '')
        .map(([entryId, v]) => ({ entryId, seedNumber: Number(v) }));
      const r = await api<DataEnvelope<DrawDto>>(`/categories/${data.category.id}/draws`, {
        method: 'POST',
        body: {
          format: format || undefined,
          seeding,
          // Приоритет разведения фиксированный: команда важнее региона.
          separation: { by: SEPARATION_KEYS.filter((k) => keys.includes(k)) },
          randomSeed: randomSeed || undefined,
        },
      });
      await onCreated(r.data);
    } catch (e) {
      const fields = e instanceof ApiError ? e.fields.map((f) => fieldMessage(f.code)).join('; ') : '';
      setError(`${describe(e)} ${fields}`.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="print:hidden">
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="draw-format"
          label={t('format')}
          hint={suggested ? t('suggested', { format: formatLabel(suggested) }) : t('noSuggestion')}
        >
          <Select
            id="draw-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as DrawFormat | '')}
          >
            {suggested ? null : <option value="">{t('chooseFormat')}</option>}
            {DRAW_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('separation')}</legend>
          <p className="mb-2 text-xs text-slate-600">{t('separationHint')}</p>
          {(['ORGANIZATION', 'REGION'] as const).map((key) => (
            <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={keys.includes(key)}
                onChange={() => toggle(key)}
              />
              {t(`keys.${key}`)}
            </label>
          ))}
        </fieldset>
      </div>
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t('seeding')}</summary>
        <p className="mb-2 text-xs text-slate-600">{t('seedingHint')}</p>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {data.participants.map((p) => (
            <li key={p.entryId} className="flex items-center gap-3 px-3 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.publicName}</span>
                <span className="block truncate text-xs text-slate-500">{p.organization?.name ?? ''}</span>
              </span>
              <label className="sr-only" htmlFor={`seed-${p.entryId}`}>
                {t('seedNumber')}
              </label>
              <Input
                id={`seed-${p.entryId}`}
                inputMode="numeric"
                className="w-20"
                placeholder="—"
                value={seeds[p.entryId] ?? ''}
                onChange={(e) => setSeeds((s) => ({ ...s, [p.entryId]: e.target.value.replace(/\D/g, '') }))}
              />
            </li>
          ))}
        </ul>
      </details>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t('advanced')}</summary>
        <Field
          id="draw-seed"
          label={t('randomSeed')}
          hint={t('randomSeedHint')}
          error={seedInvalid ? t('randomSeedInvalid') : undefined}
        >
          <Input
            id="draw-seed"
            className="font-mono"
            autoComplete="off"
            value={randomSeed}
            onChange={(e) => setRandomSeed(e.target.value.trim().toLowerCase())}
          />
        </Field>
      </details>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <Button className="mt-4" loading={busy} disabled={!format || seedInvalid} onClick={() => void submit()}>
        {t('submit')}
      </Button>
    </Card>
  );
}

export function CategoryDraws({
  competition,
  data,
  drawId,
  onSelectDraw,
}: {
  competition: Competition;
  data: CategoryDrawsDto;
  drawId: string | null;
  onSelectDraw: (id: string) => void;
}) {
  const t = useTranslations('draws');
  const locale = useLocale();
  const formatLabel = useFormatLabel();
  const invalidate = useInvalidateDraws(competition.id, data.category.id);
  const current =
    drawId ??
    data.draws.find((d) => d.status === 'PUBLISHED')?.id ??
    data.draws.find((d) => d.status === 'DRAFT')?.id ??
    null;
  const draw = useDraw(current);
  // Название категории турнира уже содержит вес («Юноши 12–15 лет, до 42 кг»).
  const categoryName = pickName(data.category.name, locale);
  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mb-0">{categoryName}</CardTitle>
          <CategoryStatusBadge status={data.category.status} />
        </div>
        <p className="mt-2 text-sm text-slate-700">
          {t('admittedCount', { admitted: data.admitted })}
          {data.admissionPending > 0 ? ` · ${t('pendingCount', { pending: data.admissionPending })}` : ''}
          {' · '}
          {data.suggestedFormat
            ? t('suggestedShort', { format: formatLabel(data.suggestedFormat) })
            : t('noFormat')}
        </p>
        {data.category.status !== 'READY_FOR_DRAW' && data.category.status !== 'DRAWN' ? (
          <Alert tone="info" className="mt-3">
            {t('notReady')}
          </Alert>
        ) : null}
        {data.category.status === 'READY_FOR_DRAW' && data.admissionPending > 0 ? (
          <Alert tone="warning" className="mt-3">
            {t('pendingBlocked')}
          </Alert>
        ) : null}
      </Card>
      {data.allowedActions.includes('draw.create') ? (
        <CreateDraft
          data={data}
          onCreated={async (d) => {
            await invalidate();
            onSelectDraw(d.id);
          }}
        />
      ) : null}
      {data.draws.length > 0 ? (
        <Card className="print:hidden">
          <CardTitle>{t('versions')}</CardTitle>
          <ul className="divide-y divide-slate-100">
            {data.draws.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  aria-current={d.id === current ? 'true' : undefined}
                  onClick={() => onSelectDraw(d.id)}
                  className={
                    d.id === current
                      ? 'flex min-h-11 w-full flex-wrap items-center gap-2 bg-blue-50 px-2 py-2 text-left'
                      : 'flex min-h-11 w-full flex-wrap items-center gap-2 px-2 py-2 text-left hover:bg-slate-50'
                  }
                >
                  <span className="font-medium">{t('version', { number: d.number })}</span>
                  <DrawStatusBadge status={d.status} />
                  <span className="text-sm text-slate-600">
                    {formatLabel(d.format)} · {t('participants', { count: d.participants })}
                  </span>
                  {d.stale ? <Badge tone="warning">{t('staleShort')}</Badge> : null}
                  {d.manualSeed ? <Badge tone="info">{t('manualSeed')}</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {current ? (
        <QueryState isPending={draw.isPending} error={draw.error}>
          {() => (
            <DrawView
              competition={competition}
              draw={draw.data as DrawDto}
              categoryName={categoryName}
              newerDraft={data.draws[0]?.id !== current}
              onChanged={invalidate}
            />
          )}
        </QueryState>
      ) : (
        <p className="text-sm text-slate-600 print:hidden">{t('noDraws')}</p>
      )}
    </div>
  );
}
