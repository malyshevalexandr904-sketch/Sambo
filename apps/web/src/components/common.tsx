'use client';
// Общие элементы экранов: состояние загрузки/ошибки запроса, бейджи статусов, форма причины.
import { Alert, Badge, Button, Field, Spinner, Textarea } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { useErrorMessage } from '@/lib/errors';

export function QueryState({
  isPending,
  error,
  children,
}: {
  isPending: boolean;
  error: unknown;
  children: () => ReactNode;
}) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-slate-600" aria-live="polite">
        <Spinner /> {t('loading')}
      </p>
    );
  }
  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  return <>{children()}</>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  PENDING_REVIEW: 'warning',
  PENDING_VERIFICATION: 'warning',
  INVITED: 'info',
  SUSPENDED: 'danger',
  BLOCKED: 'danger',
  ARCHIVED: 'neutral',
  ENDED: 'neutral',
};

const STATUS_ICON: Record<string, string> = {
  success: '●',
  warning: '◐',
  danger: '■',
  neutral: '○',
  info: '◆',
};

/** Статус — цвет + символ + текст: не только цветом (раздел 40 ТЗ). */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('statuses');
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{STATUS_ICON[tone]}</span>
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

/** Действие с обязательной причиной (попадает в аудит). */
export function ReasonAction({
  label,
  title,
  description,
  variant = 'secondary',
  required = true,
  onConfirm,
}: {
  label: string;
  title: string;
  description?: string;
  variant?: 'secondary' | 'danger' | 'primary';
  required?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `reason-${label.replace(/\W+/g, '-')}`;
  if (!open) {
    return (
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  const tooShort = required && reason.trim().length < 5;
  return (
    <div
      className="w-full rounded-md border border-slate-200 bg-slate-50 p-3"
      role="group"
      aria-labelledby={`${id}-title`}
    >
      <p id={`${id}-title`} className="font-medium">
        {title}
      </p>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
      <Field id={id} label={t('reason')} hint={t('reasonHint')} className="mt-3">
        <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button
          variant={variant === 'secondary' ? 'primary' : variant}
          disabled={tooShort}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim());
              setOpen(false);
              setReason('');
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
