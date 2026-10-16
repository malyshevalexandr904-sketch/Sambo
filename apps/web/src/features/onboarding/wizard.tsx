'use client';
// Мастер заявки на регистрацию (Phase 9a): индикатор этапа, «Назад» и «Продолжить», сохранение черновика на сервере на
// каждом шаге (введённое не теряется при возврате и после перезагрузки), ошибки рядом с полями, предпросмотр, согласие
// на обработку ПДн, отправка и статус. Проверка полноты — та же функция, что на сервере (contracts: onboardingProblems).
import { type DataEnvelope, onboardingProblems, type OnboardingRequestDto } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, PageHeader } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryState } from '@/components/common';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { DocumentsStep } from './documents';
import {
  completenessOf,
  formOf,
  type OnboardingForm,
  patchOf,
  type StepId,
  stepOfPath,
  stepsOf,
} from './form';
import { onboardingKeys, OnboardingStatusBadge, serverFieldErrors, useOnboardingRequest } from './shared';
import { ContactsStep, PersonalStep, ScenarioStep } from './steps';
import { RequestHistory, RequestSummary } from './summary';

export function OnboardingRequestPage({ id }: { id: string }) {
  const request = useOnboardingRequest(id);
  return (
    <QueryState isPending={request.isPending} error={request.error}>
      {() =>
        request.data ? (
          request.data.allowedActions.includes('update') ? (
            <Wizard key={request.data.id} initial={request.data} />
          ) : (
            <StatusView request={request.data} />
          )
        ) : null
      }
    </QueryState>
  );
}

/** Этап 8 — статус заявки и ожидание решения. */
function StatusView({ request: r }: { request: OnboardingRequestDto }) {
  const t = useTranslations('onboarding');
  return (
    <>
      <PageHeader
        title={t('status.title')}
        description={t(`roles.${r.role}`)}
        actions={
          <Link
            href="/onboarding"
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
          >
            {t('status.back')}
          </Link>
        }
      />
      <div className="space-y-6">
        <Alert
          tone={r.status === 'REJECTED' ? 'danger' : r.status === 'APPROVED' ? 'success' : 'info'}
          title={<OnboardingStatusBadge status={r.status} />}
        >
          {t(`statusMessages.${r.status}`, {
            organization: r.organization?.shortName ?? r.newOrganization?.name ?? '—',
            reason: r.decisionReason ?? '—',
          })}
        </Alert>
        <Card>
          <CardTitle>{t('status.data')}</CardTitle>
          <RequestSummary request={r} />
        </Card>
        <RequestHistory requestId={r.id} />
      </div>
    </>
  );
}

function useStepLabels(): (s: StepId) => string {
  const t = useTranslations('onboarding.steps');
  return (s) => t(s);
}

function StepIndicator({ steps, current, kind }: { steps: StepId[]; current: number; kind: string }) {
  const t = useTranslations('onboarding');
  const label = useStepLabels();
  const all = kind === 'REGISTRATION' ? ['role' as const, ...steps] : steps;
  const offset = all.length - steps.length;
  return (
    <nav aria-label={t('wizard.progress')} className="mb-6">
      <p className="mb-2 text-sm text-slate-600">
        {t('wizard.stepOf', { step: current + offset + 1, total: all.length })}
      </p>
      <ol className="flex flex-wrap gap-2">
        {all.map((s, i) => {
          const state = i < current + offset ? 'done' : i === current + offset ? 'current' : 'todo';
          return (
            <li
              key={s}
              aria-current={state === 'current' ? 'step' : undefined}
              className={
                state === 'current'
                  ? 'rounded-full bg-blue-700 px-3 py-1 text-xs font-medium text-white'
                  : state === 'done'
                    ? 'rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800 ring-1 ring-green-300'
                    : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600'
              }
            >
              {state === 'done' ? '✓ ' : `${i + 1}. `}
              {s === 'role' ? t('steps.role') : label(s)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Wizard({ initial }: { initial: OnboardingRequestDto }) {
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [request, setRequest] = useState(initial);
  const [form, setForm] = useState<OnboardingForm>(() => formOf(initial));
  const steps = stepsOf(request);
  const problems = useMemo(
    () => onboardingProblems(completenessOf(form, request), request.documentRules),
    [form, request],
  );
  // Черновик открывается на первом незаполненном шаге (продолжение заполнения).
  const [step, setStep] = useState(() => {
    const first = problems[0];
    return first ? Math.max(0, steps.indexOf(stepOfPath(first.path))) : steps.length - 1;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const current = steps[step] ?? 'review';

  useEffect(() => headingRef.current?.focus(), [step]);

  const accept = (next: OnboardingRequestDto): void => {
    setRequest(next);
    queryClient.setQueryData(onboardingKeys.request(next.id), next);
  };

  /** Сохранение черновика: сервер возвращает заявку с новой версией и правилами документов сценария. */
  const save = async (): Promise<OnboardingRequestDto | null> => {
    try {
      const res = await api<DataEnvelope<OnboardingRequestDto>>(`/onboarding/requests/${request.id}`, {
        method: 'PATCH',
        version: request.version,
        body: patchOf(form, request),
      });
      accept(res.data);
      return res.data;
    } catch (e) {
      setErrors(serverFieldErrors(e));
      setError(errorMessage(e));
      return null;
    }
  };

  const go = async (delta: 1 | -1): Promise<void> => {
    setBusy(true);
    setError(null);
    setErrors({});
    const saved = current === 'documents' || current === 'review' ? request : await save();
    setBusy(false);
    if (!saved) return;
    if (delta === 1) {
      const fresh = onboardingProblems(completenessOf(form, saved), saved.documentRules).filter(
        (p) => stepOfPath(p.path) === current,
      );
      if (fresh.length > 0) {
        setErrors(Object.fromEntries(fresh.map((p) => [p.path, p.code])));
        setError(t('wizard.fixErrors'));
        return;
      }
    }
    setStep((s) => Math.min(steps.length - 1, Math.max(0, s + delta)));
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const res = await api<DataEnvelope<OnboardingRequestDto>>(`/onboarding/requests/${request.id}/submit`, {
        method: 'POST',
        version: request.version,
        body: { consentPersonalData: true },
      });
      queryClient.setQueryData(onboardingKeys.request(request.id), res.data);
      await queryClient.invalidateQueries({ queryKey: onboardingKeys.overview });
      router.replace(`/onboarding/${request.id}`);
    } catch (e) {
      setErrors(serverFieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const stepProps = { request, form, setForm, errors };
  return (
    <>
      <PageHeader
        title={t(`wizard.title.${request.kind}`, { role: t(`roles.${request.role}`) })}
        description={
          request.status === 'CHANGES_REQUESTED'
            ? t('wizard.changesRequested', { reason: request.decisionReason ?? '—' })
            : t('wizard.lead')
        }
      />
      <StepIndicator steps={steps} current={step} kind={request.kind} />
      <Card>
        <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-lg font-semibold outline-none">
          {t(`steps.${current}`)}
        </h2>
        {error ? (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        ) : null}
        {current === 'scenario' ? <ScenarioStep {...stepProps} /> : null}
        {current === 'personal' ? <PersonalStep {...stepProps} /> : null}
        {current === 'documents' ? (
          <DocumentsStep request={request} errors={errors} onChanged={accept} />
        ) : null}
        {current === 'contacts' ? <ContactsStep {...stepProps} /> : null}
        {current === 'review' ? (
          <ReviewStep
            request={request}
            problems={problems}
            consent={consent}
            setConsent={setConsent}
            goTo={(s) => setStep(steps.indexOf(s))}
          />
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="secondary" disabled={step === 0 || busy} onClick={() => void go(-1)}>
            {t('wizard.back')}
          </Button>
          {current === 'review' ? (
            <Button loading={busy} disabled={!consent || problems.length > 0} onClick={() => void submit()}>
              {t('wizard.submit')}
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void go(1)}>
              {t('wizard.next')}
            </Button>
          )}
        </div>
      </Card>
      <p className="mt-4 text-sm text-slate-500">{t('wizard.autosave')}</p>
    </>
  );
}

/** Этапы 6–7 — проверка введённых данных и согласие перед отправкой. */
function ReviewStep({
  request,
  problems,
  consent,
  setConsent,
  goTo,
}: {
  request: OnboardingRequestDto;
  problems: { path: string; code: string }[];
  consent: boolean;
  setConsent: (v: boolean) => void;
  goTo: (s: StepId) => void;
}) {
  const t = useTranslations('onboarding');
  const label = useStepLabels();
  return (
    <div className="space-y-5">
      <RequestSummary request={request} />
      {problems.length > 0 ? (
        <Alert tone="warning" title={t('wizard.incomplete')}>
          <ul className="mt-1 space-y-1">
            {[...new Set(problems.map((p) => stepOfPath(p.path)))].map((s) => (
              <li key={s}>
                <button type="button" className="text-blue-800 underline" onClick={() => goTo(s)}>
                  {t('wizard.fixStep', { step: label(s) })}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p>{t('consent.text')}</p>
        <label className="mt-3 flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{t('consent.checkbox')}</span>
        </label>
      </div>
    </div>
  );
}
