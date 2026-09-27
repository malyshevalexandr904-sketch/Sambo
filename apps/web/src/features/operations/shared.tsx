'use client';
// Общее для экранов мандатной комиссии: бейджи допуска, прибытия и взвешивания, текст причины проверки.
import { type AdmissionCheckDto, type AdmissionSummary, type ConsentKind, gramsToKg } from '@sde/contracts';
import { Badge } from '@sde/ui';
import { useLocale, useTranslations } from 'next-intl';
import { pickName, useDocumentTypes } from '@/lib/queries';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';
const ICON: Record<Tone, string> = { success: '●', warning: '◐', danger: '■', neutral: '○', info: '◆' };

/** Статус — цвет, символ и текст (раздел 40 ТЗ: не только цветом). */
function ToneBadge({ tone, text }: { tone: Tone; text: string }) {
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{ICON[tone]}</span>
      {text}
    </Badge>
  );
}

const ADMISSION_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  ADMITTED: 'success',
  NOT_ADMITTED: 'danger',
};
const CHECK_IN_TONE: Record<string, Tone> = {
  EXPECTED: 'neutral',
  ARRIVED: 'success',
  NOT_ARRIVED: 'danger',
  WITHDRAWN: 'neutral',
};
const WEIGH_IN_TONE: Record<string, Tone> = {
  EXPECTED: 'neutral',
  PASSED: 'success',
  FAILED: 'danger',
  RECHECK_REQUIRED: 'warning',
};
const CHECK_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  PASSED: 'success',
  FAILED: 'danger',
  WAIVED: 'info',
};

export function AdmissionBadge({ status }: { status: string }) {
  const t = useTranslations('admission.statuses');
  return <ToneBadge tone={ADMISSION_TONE[status] ?? 'neutral'} text={t(status)} />;
}

export function CheckInBadge({ status }: { status: string }) {
  const t = useTranslations('checkin.statuses');
  return <ToneBadge tone={CHECK_IN_TONE[status] ?? 'neutral'} text={t(status)} />;
}

export function WeighInBadge({ status }: { status: string }) {
  const t = useTranslations('weighin.statuses');
  return <ToneBadge tone={WEIGH_IN_TONE[status] ?? 'neutral'} text={t(status)} />;
}

/** Текст причины проверки: типы документов и виды согласий — по справочникам, вес — в килограммах. */
export function useReasonText(): (
  check: Pick<AdmissionCheckDto, 'reasonCode' | 'reasonParams'>,
) => string | null {
  const t = useTranslations('admission.reasons');
  const kinds = useTranslations('consents.kinds');
  const locale = useLocale();
  const types = useDocumentTypes();
  return ({ reasonCode, reasonParams }) => {
    if (!reasonCode) return null;
    const p = reasonParams ?? {};
    const typeNames = (Array.isArray(p.types) ? (p.types as string[]) : []).map((code) => {
      const type = types.data?.find((x) => x.code === code);
      return type ? pickName(type.name, locale) : code;
    });
    const kindNames = (Array.isArray(p.kinds) ? (p.kinds as ConsentKind[]) : []).map((k) => kinds(k));
    const weight =
      typeof p.weightGrams === 'number' ? gramsToKg(p.weightGrams, locale === 'en' ? 'en' : 'ru') : '';
    return t(reasonCode, { types: typeNames.join(', '), kinds: kindNames.join(', '), weight });
  };
}

/** Одна проверка: вид, статус, причина; исключённая — с причиной исключения. */
export function CheckChip({ check }: { check: AdmissionCheckDto }) {
  const t = useTranslations('admission');
  const reason = useReasonText()(check);
  const tone = CHECK_TONE[check.status] ?? 'neutral';
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <ToneBadge
        tone={tone}
        text={`${t(`checkKinds.${check.kind}`)}: ${t(`checkStatuses.${check.status}`)}`}
      />
      {reason ? <span className="text-slate-600">{reason}</span> : null}
      {check.status === 'WAIVED' && check.waiverReason ? (
        <span className="text-slate-600">{t('waivedBecause', { reason: check.waiverReason })}</span>
      ) : null}
    </li>
  );
}

/** Краткий допуск для списков: статус и непройденные проверки. */
export function AdmissionSummaryView({ summary }: { summary: AdmissionSummary }) {
  const t = useTranslations('admission');
  const problems = [...summary.failed, ...summary.pending];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <AdmissionBadge status={summary.status} />
      {problems.length > 0 ? (
        <span className="text-xs text-slate-600">{problems.map((k) => t(`checkKinds.${k}`)).join(', ')}</span>
      ) : null}
    </span>
  );
}

/** Фамилия Имя Отчество одной строкой. */
export const athleteName = (a: { lastName: string; firstName: string; middleName: string | null }): string =>
  [a.lastName, a.firstName, a.middleName].filter(Boolean).join(' ');
