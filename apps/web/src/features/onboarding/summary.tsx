'use client';
// Сводка заявки (Phase 9a): предварительный просмотр перед отправкой, карточка проверяющего, история статусов.
import { type DataEnvelope, type OnboardingHistoryDto, type OnboardingRequestDto } from '@sde/contracts';
import { Card, CardTitle } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { QueryState } from '@/components/common';
import { useDocumentTypeName } from '@/features/documents/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { pickName, useRefereeCategories } from '@/lib/queries';
import { DocumentLink } from './documents';
import { onboardingKeys, OnboardingStatusBadge } from './shared';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2 sm:grid-cols-3">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 sm:col-span-2">{children}</dd>
    </div>
  );
}

export function RequestSummary({ request: r }: { request: OnboardingRequestDto }) {
  const t = useTranslations('onboarding');
  const tp = useTranslations('people');
  const locale = useLocale();
  const categories = useRefereeCategories();
  const typeName = useDocumentTypeName();
  const none = '—';
  const category = categories.data?.find((c) => c.code === r.refereeCategoryCode);
  const o = r.newOrganization;
  const fullName = [r.lastName, r.firstName, r.middleName].filter(Boolean).join(' ');
  return (
    <dl>
      <Row label={t('fields.role')}>
        {t(`roles.${r.role}`)}
        {r.kind === 'JOIN_ORGANIZATION' ? ` · ${t('kinds.JOIN_ORGANIZATION')}` : ''}
      </Row>
      {r.kind === 'REGISTRATION' ? (
        <>
          <Row label={t('fields.fullName')}>{fullName || none}</Row>
          <Row label={tp('birthDate')}>{r.birthDate ? formatDate(r.birthDate, locale) : none}</Row>
          <Row label={tp('gender')}>{r.gender ? tp(`genders.${r.gender}`) : none}</Row>
          <Row label={t('fields.phone')}>{r.phone ?? none}</Row>
          <Row label={t('fields.email')}>{r.contactEmail ?? none}</Row>
        </>
      ) : null}
      {r.role === 'COACH' || r.role === 'ATHLETE' ? (
        <Row label={t('fields.organization')}>
          {r.organization ? r.organization.name : r.inOrganization === false ? t('fields.independent') : none}
        </Row>
      ) : null}
      {r.role === 'ATHLETE' && r.organization ? (
        <Row label={t('fields.coach')}>{r.coach?.publicName ?? none}</Row>
      ) : null}
      {r.role === 'COACH' ? (
        <Row label={t('fields.coachQualification')}>{r.coachQualification ?? none}</Row>
      ) : null}
      {r.role === 'REFEREE' ? (
        <Row label={t('fields.refereeCategory')}>
          {category ? pickName(category.name, locale) : (r.refereeCategoryCode ?? none)}
        </Row>
      ) : null}
      {o ? (
        <>
          <Row label={t('fields.orgName')}>{o.name ?? none}</Row>
          <Row label={t('fields.orgType')}>{o.type ? t(`orgTypes.${o.type}`) : none}</Row>
          <Row label={t('fields.legalForm')}>{o.legalForm ? t(`legalForms.${o.legalForm}`) : none}</Row>
          <Row label={t('fields.country')}>{o.countryCode ?? none}</Row>
          {o.inn ? <Row label={t('fields.inn')}>{o.inn}</Row> : null}
          {o.legalName ? <Row label={t('fields.legalName')}>{o.legalName}</Row> : null}
        </>
      ) : null}
      {r.kind === 'REGISTRATION' ? (
        <Row label={t('fields.contactChannels')}>
          {r.contactChannels.map((c) => t(`channels.${c}`)).join(', ') || none}
          {r.telegram ? ` (@${r.telegram})` : ''}
        </Row>
      ) : null}
      <Row label={t('fields.documents')}>
        {r.documents.length === 0 ? (
          none
        ) : (
          <ul className="space-y-1">
            {r.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {typeName(d.typeCode)} — <span className="break-all">{d.fileName}</span>
                </span>
                <DocumentLink requestId={r.id} doc={d} />
              </li>
            ))}
          </ul>
        )}
      </Row>
    </dl>
  );
}

export function RequestHistory({ requestId }: { requestId: string }) {
  const t = useTranslations('onboarding');
  const locale = useLocale();
  const history = useQuery({
    queryKey: onboardingKeys.history(requestId),
    queryFn: async () =>
      (await api<DataEnvelope<OnboardingHistoryDto[]>>(`/onboarding/requests/${requestId}/history`)).data,
  });
  return (
    <Card>
      <CardTitle>{t('history.title')}</CardTitle>
      <QueryState isPending={history.isPending} error={history.error}>
        {() => (
          <ol className="space-y-3">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <OnboardingStatusBadge status={h.toStatus} />
                  <span className="text-slate-500">{formatDateTime(h.createdAt, locale)}</span>
                  {h.actor ? <span className="text-slate-700">{h.actor.displayName}</span> : null}
                </div>
                {h.reason ? (
                  <p className="mt-1 text-slate-700">{t('history.reason', { reason: h.reason })}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Card>
  );
}
