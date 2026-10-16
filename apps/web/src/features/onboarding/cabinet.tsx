'use client';
// Личный кабинет регистрации (Phase 9a): статус заявок понятными словами, продолжение черновика, новая заявка по роли,
// присоединение к организации позже. Профили и доступы выдаёт сервер после одобрения.
import {
  type DataEnvelope,
  ONBOARDING_ROLES,
  type OnboardingKind,
  type OnboardingOverviewDto,
  type OnboardingRequestDto,
  type OnboardingRole,
  isOpenOnboardingStatus,
} from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, PageHeader } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';
import { onboardingKeys, OnboardingStatusBadge, useOnboardingOverview } from './shared';

export function OnboardingCabinet() {
  const t = useTranslations('onboarding');
  const overview = useOnboardingOverview();
  return (
    <>
      <PageHeader title={t('cabinet.title')} description={t('cabinet.lead')} />
      <QueryState isPending={overview.isPending} error={overview.error}>
        {() => (overview.data ? <CabinetBody data={overview.data} /> : null)}
      </QueryState>
    </>
  );
}

function CabinetBody({ data }: { data: OnboardingOverviewDto }) {
  const t = useTranslations('onboarding');
  const open = data.requests.filter((r) => isOpenOnboardingStatus(r.status));
  const closed = data.requests.filter((r) => !isOpenOnboardingStatus(r.status));
  const has: Record<OnboardingRole, boolean> = {
    ORGANIZATION_HEAD: false,
    COACH: !!data.profiles.coachId,
    ATHLETE: !!data.profiles.athleteId,
    REFEREE: !!data.profiles.refereeId,
  };
  const busyRoles = new Set(open.map((r) => r.role));
  const available = ONBOARDING_ROLES.filter((r) => !has[r] && !busyRoles.has(r));
  const joinable = (['COACH', 'ATHLETE'] as const).filter((r) => has[r] && !busyRoles.has(r));
  return (
    <div className="space-y-6">
      {open.map((r) => (
        <RequestCard key={r.id} request={r} />
      ))}
      <Profiles data={data} />
      {joinable.length > 0 ? (
        <Card>
          <CardTitle>{t('cabinet.joinTitle')}</CardTitle>
          <p className="mb-4 text-sm text-slate-600">{t('cabinet.joinHint')}</p>
          <div className="flex flex-wrap gap-2">
            {joinable.map((role) => (
              <StartButton
                key={role}
                role={role}
                kind="JOIN_ORGANIZATION"
                label={t(`cabinet.join.${role}`)}
              />
            ))}
          </div>
        </Card>
      ) : null}
      {available.length > 0 ? <RoleChooser roles={available} first={data.requests.length === 0} /> : null}
      {closed.length > 0 ? (
        <section aria-labelledby="onboarding-history">
          <h2 id="onboarding-history" className="mb-3 text-lg font-semibold">
            {t('cabinet.past')}
          </h2>
          <div className="space-y-3">
            {closed.map((r) => (
              <RequestCard key={r.id} request={r} compact />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Состояние заявки словами (ТЗ, раздел 9) и доступные заявителю действия. */
function RequestCard({ request: r, compact = false }: { request: OnboardingRequestDto; compact?: boolean }) {
  const t = useTranslations('onboarding');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const router = useRouter();
  const action = useAction();
  const canEdit = r.allowedActions.includes('update');
  const message = t(`statusMessages.${r.status}`, {
    organization: r.organization?.shortName ?? r.newOrganization?.name ?? '—',
    reason: r.decisionReason ?? '—',
  });
  const cancel = () =>
    action.run(async () => {
      await api(`/onboarding/requests/${r.id}/cancel`, { method: 'POST', version: r.version });
      await queryClient.invalidateQueries({ queryKey: onboardingKeys.overview });
    });
  return (
    <Card className={compact ? 'p-4 sm:p-4' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {t(`roles.${r.role}`)}
          {r.kind === 'JOIN_ORGANIZATION' ? ` · ${t('kinds.JOIN_ORGANIZATION')}` : ''}
        </h2>
        <OnboardingStatusBadge status={r.status} />
      </div>
      <p className="mt-2 text-sm text-slate-700" aria-live="polite">
        {message}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {r.submittedAt
          ? t('cabinet.submittedAt', { at: formatDateTime(r.submittedAt, locale) })
          : t('cabinet.createdAt', { at: formatDateTime(r.createdAt, locale) })}
      </p>
      {action.error ? (
        <Alert tone="danger" className="mt-3">
          {action.error}
        </Alert>
      ) : null}
      {!compact || canEdit || r.status === 'APPROVED' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {canEdit ? (
            <Button onClick={() => router.push(`/onboarding/${r.id}`)}>
              {r.status === 'CHANGES_REQUESTED' ? t('cabinet.fix') : t('cabinet.continue')}
            </Button>
          ) : (
            <Link
              href={`/onboarding/${r.id}`}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              {t('cabinet.open')}
            </Link>
          )}
          {r.status === 'APPROVED' ? (
            <Link
              href="/admin"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
            >
              {t('cabinet.toCabinet')}
            </Link>
          ) : null}
          {r.allowedActions.includes('cancel') ? (
            <Button variant="ghost" loading={action.busy} onClick={() => void cancel()}>
              {t('cabinet.cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Profiles({ data }: { data: OnboardingOverviewDto }) {
  const t = useTranslations('onboarding');
  const p = data.profiles;
  const items = [
    p.athleteId ? t('roles.ATHLETE') : null,
    p.coachId ? t('roles.COACH') : null,
    p.refereeId ? t('roles.REFEREE') : null,
    p.managedOrganizationIds.length > 0 ? t('roles.ORGANIZATION_HEAD') : null,
  ].filter((x): x is string => !!x);
  if (items.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t('cabinet.profiles')}</CardTitle>
      <ul className="list-inside list-disc text-sm text-slate-700">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </Card>
  );
}

function StartButton({ role, kind, label }: { role: OnboardingRole; kind: OnboardingKind; label: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const action = useAction();
  return (
    <div>
      <Button
        variant="secondary"
        loading={action.busy}
        onClick={() =>
          void action.run(async () => {
            const res = await api<DataEnvelope<OnboardingRequestDto>>('/onboarding/requests', {
              method: 'POST',
              body: { role, kind },
            });
            await queryClient.invalidateQueries({ queryKey: onboardingKeys.overview });
            router.push(`/onboarding/${res.data.id}`);
          })
        }
      >
        {label}
      </Button>
      {action.error ? <p className="mt-1 text-sm text-red-700">{action.error}</p> : null}
    </div>
  );
}

/** Шаг 1 — выбор роли. Администратор платформы здесь не выбирается: роль выдаётся только уполномоченным способом. */
function RoleChooser({ roles, first }: { roles: readonly OnboardingRole[]; first: boolean }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const action = useAction();
  const start = (role: OnboardingRole) =>
    action.run(async () => {
      const res = await api<DataEnvelope<OnboardingRequestDto>>('/onboarding/requests', {
        method: 'POST',
        body: { role },
      });
      await queryClient.invalidateQueries({ queryKey: onboardingKeys.overview });
      await queryClient.invalidateQueries({ queryKey: qk.me });
      router.push(`/onboarding/${res.data.id}`);
    });
  return (
    <section aria-labelledby="onboarding-roles">
      <h2 id="onboarding-roles" className="mb-1 text-lg font-semibold">
        {first ? t('cabinet.chooseRole') : t('cabinet.anotherRole')}
      </h2>
      <p className="mb-4 text-sm text-slate-600">{t('cabinet.chooseRoleHint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : null}
      {roles.length === 0 ? (
        <EmptyState title={t('cabinet.noRoles')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <button
              key={role}
              type="button"
              disabled={action.busy}
              onClick={() => void start(role)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60"
            >
              <span className="block font-semibold text-slate-900">{t(`roles.${role}`)}</span>
              <span className="mt-1 block text-sm text-slate-600">{t(`roleHints.${role}`)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
