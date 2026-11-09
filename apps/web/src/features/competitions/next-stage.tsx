'use client';
// Кнопка перехода к следующей стадии прямо во вкладке, где эта стадия заканчивается (правки 09.11.2026): «Комиссия
// пройдена» в «Заявках», «Завершить взвешивание» во «Взвешивании». Переход и его условия проверяет сервер; если
// остались предупреждения (например, нерассмотренные заявки) — их показывают и просят подтвердить.
import type { Competition, CompetitionStatus, DataEnvelope } from '@sde/contracts';
import { Alert, Button } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { qk } from '@/lib/queries';
import { useFailedText } from './shared';

export function useTransition(c: Competition) {
  const errorMessage = useErrorMessage();
  const failedText = useFailedText();
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<{ to: string; codes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (to: CompetitionStatus, extra: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const fresh = queryClient.getQueryData<Competition>(qk.competition(c.id)) ?? c;
      const res = await api<DataEnvelope<Competition>>(`/competitions/${c.id}/transitions`, {
        method: 'POST',
        body: { to, ...extra },
        version: fresh.version,
      });
      queryClient.setQueryData(qk.competition(c.id), res.data);
      await queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
      setWarnings(null);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TRANSITION_PRECONDITIONS_NOT_MET') {
        const d = e.details as { failed?: string[]; warnings?: string[]; confirmable?: boolean } | undefined;
        if (d?.confirmable && d.warnings?.length) {
          setWarnings({ to, codes: d.warnings });
          return false;
        }
        setError(`${errorMessage(e)} ${failedText(d?.failed ?? [])}`);
        return false;
      }
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { go, busy, error, warnings, setWarnings, failedText, setError };
}

export function NextStageButton({
  competition: c,
  to,
  label,
}: {
  competition: Competition;
  to: CompetitionStatus;
  label: string;
}) {
  const t = useTranslations('competitions');
  const tr = useTransition(c);
  if (!c.allowedActions.includes(`transition:${to}`)) return null;
  return (
    <div className="space-y-2">
      {tr.error ? <Alert tone="danger">{tr.error}</Alert> : null}
      {tr.warnings ? (
        <Alert tone="warning">
          <p>{t('confirmWarnings', { warnings: tr.failedText(tr.warnings.codes) })}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" loading={tr.busy} onClick={() => void tr.go(to, { confirm: true })}>
              {t('confirmAndContinue')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => tr.setWarnings(null)}>
              {t('cancel')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <Button loading={tr.busy} onClick={() => void tr.go(to)}>
        {label}
      </Button>
    </div>
  );
}
