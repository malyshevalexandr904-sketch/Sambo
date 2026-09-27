'use client';
// Действия над участием (API.md, 5.3): решение секретариата, снятие, перевод в другую категорию, удаление
// из черновика заявки и обновление снимка данных спортсмена. Кнопки — по allowedActions, решает сервер.
import type { CompetitionCategoryDto, EntryDto } from '@sde/contracts';
import { Alert, Button, Field, Select } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonAction } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { pickName } from '@/lib/queries';

const TRANSFER_TARGET = ['REGISTRATION', 'CLOSED', 'WEIGH_IN', 'READY_FOR_DRAW'];

export function EntryActions({
  entry,
  categories,
  onChanged,
}: {
  entry: EntryDto;
  /** Категории турнира — для перевода; не переданы — перевод не показывается. */
  categories?: CompetitionCategoryDto[];
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('applications.entry');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [target, setTarget] = useState('');
  const can = (a: string): boolean => entry.allowedActions.includes(a);
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const targets = (categories ?? []).filter(
    (c) => c.id !== entry.category.id && TRANSFER_TARGET.includes(c.status),
  );
  const targetId = target || targets[0]?.id || '';
  return (
    <div className="flex max-w-sm flex-wrap gap-2">
      {error ? (
        <Alert tone="danger" className="w-full">
          {error}
        </Alert>
      ) : null}
      {can('entry.approve') ? (
        <Button
          size="sm"
          loading={busy}
          onClick={() =>
            void run(() =>
              api(`/entries/${entry.id}/decision`, {
                method: 'POST',
                body: { decision: 'APPROVED' },
                version: entry.version,
              }),
            )
          }
        >
          {t('approve')}
        </Button>
      ) : null}
      {can('entry.reject') ? (
        <ReasonAction
          size="sm"
          variant="danger"
          label={t('reject')}
          title={t('rejectTitle', { name: entry.publicName })}
          onConfirm={(reason) =>
            run(() =>
              api(`/entries/${entry.id}/decision`, {
                method: 'POST',
                body: { decision: 'REJECTED', reason },
                version: entry.version,
              }),
            )
          }
        />
      ) : null}
      {can('entry.refresh_snapshot') ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() =>
            void run(() =>
              api(`/entries/${entry.id}/refresh-snapshot`, { method: 'POST', version: entry.version }),
            )
          }
        >
          {t('refreshSnapshot')}
        </Button>
      ) : null}
      {can('entry.delete') ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() =>
            void run(() =>
              api(`/applications/${entry.applicationId}/entries/${entry.id}`, { method: 'DELETE' }),
            )
          }
        >
          {t('remove')}
        </Button>
      ) : null}
      {can('entry.withdraw') && !can('entry.delete') ? (
        <ReasonAction
          size="sm"
          label={t('withdraw')}
          title={t('withdrawTitle', { name: entry.publicName })}
          onConfirm={(reason) =>
            run(() =>
              api(`/entries/${entry.id}/withdraw`, {
                method: 'POST',
                body: { reason },
                version: entry.version,
              }),
            )
          }
        />
      ) : null}
      {can('entry.transfer') && categories && targets.length > 0 ? (
        transfer ? (
          <div className="w-full space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <Field id={`transfer-${entry.id}`} label={t('transferTo')}>
              <Select
                id={`transfer-${entry.id}`}
                value={targetId}
                onChange={(e) => setTarget(e.target.value)}
              >
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pickName(c.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <ReasonAction
              label={t('transferConfirm')}
              title={t('transferTitle', { name: entry.publicName })}
              onConfirm={(reason) =>
                run(async () => {
                  await api(`/entries/${entry.id}/transfer-category`, {
                    method: 'POST',
                    body: { toCategoryId: targetId, reason },
                    version: entry.version,
                  });
                  setTransfer(false);
                })
              }
            />
            <Button size="sm" variant="ghost" onClick={() => setTransfer(false)}>
              {t('cancel')}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setTransfer(true)}>
            {t('transfer')}
          </Button>
        )
      ) : null}
    </div>
  );
}
