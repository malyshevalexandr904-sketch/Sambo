'use client';
// Открытый набор судей (правки 27.10.2026): при создании турнира (или в заявке на проведение) организатор объявляет
// набор — должности персонала и требования к кандидатам; на странице турнира — должности, поступившие заявки судей,
// одобрение или отклонение каждой, закрытие набора и новые должности. Права — `competition.members.manage`.
import {
  type Competition,
  type DataEnvelope,
  RECRUITMENT_REQUIREMENTS_MAX,
  RECRUITMENT_ROLE_CODES,
  type RefereeApplicationDto,
  type RefereeRecruitmentPositionDto,
  type RefereeRecruitmentPositionInput,
  type RoleCode,
} from '@sde/contracts';
import { Alert, Badge, Button, Card, CardTitle, EmptyState, Field, Select, Textarea } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { useErrorMessage, useFieldMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { pickName } from '@/lib/queries';

// ---------- Набор при создании турнира ----------

export interface RecruitmentDraft {
  open: boolean;
  positions: RefereeRecruitmentPositionInput[];
}

export const emptyRecruitment = (): RecruitmentDraft => ({ open: false, positions: [] });

const newPosition = (): RefereeRecruitmentPositionInput => ({
  roleCode: 'REFEREE',
  requirements: '',
});

/** Тело запроса: должности набора или undefined, если набор не объявлен. */
export function recruitmentBody(d: RecruitmentDraft): RefereeRecruitmentPositionInput[] | undefined {
  if (!d.open) return undefined;
  return d.positions.map((p) => ({ roleCode: p.roleCode, requirements: p.requirements.trim() }));
}

/** Проверка до отправки: у каждой должности есть требования. Ключи — пути полей, как в ответе сервера. */
export function recruitmentIssues(d: RecruitmentDraft): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!d.open) return issues;
  d.positions.forEach((p, i) => {
    if (!p.requirements.trim()) issues[`refereeRecruitment.${i}.requirements`] = 'required';
  });
  return issues;
}

export function RecruitmentDraftCard({
  value,
  onChange,
  errors,
}: {
  value: RecruitmentDraft;
  onChange: (next: RecruitmentDraft) => void;
  errors: Record<string, string>;
}) {
  const t = useTranslations();
  const tf = useFieldMessage();
  const setPosition = (i: number, patch: Partial<RefereeRecruitmentPositionInput>): void =>
    onChange({ ...value, positions: value.positions.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Card>
      <CardTitle>{t('recruitment.title')}</CardTitle>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={value.open}
          onChange={(e) =>
            onChange({
              open: e.target.checked,
              positions: e.target.checked && value.positions.length === 0 ? [newPosition()] : value.positions,
            })
          }
        />
        {t('recruitment.announce')}
      </label>
      <p className="mb-3 text-sm text-slate-600">{t('recruitment.announceHint')}</p>
      {value.open ? (
        <div className="space-y-4">
          {value.positions.map((p, i) => (
            <fieldset key={i} className="grid gap-3 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">{t('recruitment.position', { n: i + 1 })}</legend>
              <Field id={`rr-role-${i}`} label={t('recruitment.role')}>
                <Select
                  id={`rr-role-${i}`}
                  value={p.roleCode}
                  onChange={(e) => setPosition(i, { roleCode: e.target.value as RoleCode })}
                >
                  {RECRUITMENT_ROLE_CODES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id={`rr-req-${i}`}
                label={t('recruitment.requirements')}
                hint={t('recruitment.requirementsHint')}
                error={tf(errors[`refereeRecruitment.${i}.requirements`])}
              >
                <Textarea
                  id={`rr-req-${i}`}
                  rows={3}
                  maxLength={RECRUITMENT_REQUIREMENTS_MAX}
                  value={p.requirements}
                  onChange={(e) => setPosition(i, { requirements: e.target.value })}
                />
              </Field>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...value, positions: value.positions.filter((_, j) => j !== i) })}
                >
                  {t('recruitment.removePosition')}
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ ...value, positions: [...value.positions, newPosition()] })}
          >
            {t('recruitment.addPosition')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Должности набора из заявки на проведение (для просмотра заявки). */
export function RecruitmentSummary({ positions }: { positions: RefereeRecruitmentPositionInput[] }) {
  const t = useTranslations();
  if (positions.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t('recruitment.title')}</CardTitle>
      <ul className="space-y-3">
        {positions.map((p, i) => (
          <li key={i}>
            <p className="font-medium">{t(`roles.${p.roleCode}`)}</p>
            <p className="whitespace-pre-line text-sm text-slate-700">{p.requirements}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Вкладка турнира ----------

const recruitmentKey = (competitionId: string) =>
  ['competitions', competitionId, 'referee-recruitment'] as const;

export function RecruitmentTab({ competition: c }: { competition: Competition }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: recruitmentKey(c.id),
    queryFn: async () =>
      (await api<DataEnvelope<RefereeRecruitmentPositionDto[]>>(`/competitions/${c.id}/referee-recruitment`))
        .data,
  });
  const run = async (fn: () => Promise<DataEnvelope<RefereeRecruitmentPositionDto[]>>): Promise<void> => {
    setError(null);
    try {
      queryClient.setQueryData(recruitmentKey(c.id), (await fn()).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setStatus = (p: RefereeRecruitmentPositionDto, status: 'OPEN' | 'CLOSED') =>
    run(() =>
      api(`/competitions/${c.id}/referee-recruitment/${p.id}`, {
        method: 'PATCH',
        body: { status },
        version: p.version,
      }),
    );
  const decide = (a: RefereeApplicationDto, decision: 'APPROVE' | 'REJECT') =>
    run(async () => {
      const res = await api<DataEnvelope<RefereeRecruitmentPositionDto[]>>(
        `/competitions/${c.id}/referee-recruitment/applications/${a.id}/decision`,
        { method: 'POST', body: { decision }, version: a.version },
      );
      // Одобренный судья — в персонале турнира.
      if (decision === 'APPROVE') await queryClient.invalidateQueries({ queryKey: ['competitions', c.id] });
      return res;
    });
  return (
    <div className="space-y-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          (query.data ?? []).length === 0 ? (
            <EmptyState title={t('recruitment.empty')} />
          ) : (
            <ul className="space-y-4">
              {(query.data ?? []).map((p) => (
                <li key={p.id}>
                  <PositionCard
                    position={p}
                    onStatus={(s) => void setStatus(p, s)}
                    onDecide={(a, d) => void decide(a, d)}
                  />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <AddPositionCard
        competitionId={c.id}
        onAdded={(rows) => queryClient.setQueryData(recruitmentKey(c.id), rows)}
      />
    </div>
  );
}

const APPLICATION_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

function PositionCard({
  position: p,
  onStatus,
  onDecide,
}: {
  position: RefereeRecruitmentPositionDto;
  onStatus: (status: 'OPEN' | 'CLOSED') => void;
  onDecide: (a: RefereeApplicationDto, decision: 'APPROVE' | 'REJECT') => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="mb-1">{t(`roles.${p.roleCode}`)}</CardTitle>
          <Badge tone={p.status === 'OPEN' ? 'success' : 'neutral'}>
            {t(`recruitment.status.${p.status}`)}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onStatus(p.status === 'OPEN' ? 'CLOSED' : 'OPEN')}
        >
          {p.status === 'OPEN' ? t('recruitment.close') : t('recruitment.reopen')}
        </Button>
      </div>
      <p className="text-sm font-medium text-slate-600">{t('recruitment.requirements')}</p>
      <p className="mb-4 whitespace-pre-line text-sm">{p.requirements}</p>
      <h3 className="mb-2 text-sm font-semibold">{t('recruitment.applications')}</h3>
      {p.applications.length === 0 ? (
        <p className="text-sm text-slate-600">{t('recruitment.noApplications')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {p.applications.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <p className="font-medium">{a.applicant.displayName}</p>
                <p className="text-slate-600">
                  {[
                    a.applicant.email,
                    a.refereeCategory ? pickName(a.refereeCategory.name, locale) : null,
                    formatDateTime(a.createdAt, locale),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {a.status === 'PENDING' ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onDecide(a, 'APPROVE')}>
                    {t('recruitment.approve')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDecide(a, 'REJECT')}>
                    {t('recruitment.reject')}
                  </Button>
                </div>
              ) : (
                <Badge tone={APPLICATION_TONE[a.status]}>
                  {t(`recruitment.applicationStatus.${a.status}`)}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddPositionCard({
  competitionId,
  onAdded,
}: {
  competitionId: string;
  onAdded: (rows: RefereeRecruitmentPositionDto[]) => void;
}) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const tf = useFieldMessage();
  const [roleCode, setRoleCode] = useState<string>('REFEREE');
  const [requirements, setRequirements] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  return (
    <Card>
      <CardTitle>{t('recruitment.addTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('recruitment.announceHint')}</p>
      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setFieldError(undefined);
          if (!requirements.trim()) {
            setFieldError('required');
            return;
          }
          setBusy(true);
          try {
            const res = await api<DataEnvelope<RefereeRecruitmentPositionDto[]>>(
              `/competitions/${competitionId}/referee-recruitment`,
              { method: 'POST', body: { roleCode, requirements: requirements.trim() } },
            );
            setRequirements('');
            onAdded(res.data);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="rr-add-role" label={t('recruitment.role')}>
          <Select id="rr-add-role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
            {RECRUITMENT_ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="rr-add-req"
          label={t('recruitment.requirements')}
          hint={t('recruitment.requirementsHint')}
          error={tf(fieldError)}
        >
          <Textarea
            id="rr-add-req"
            rows={3}
            maxLength={RECRUITMENT_REQUIREMENTS_MAX}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" loading={busy}>
            {t('recruitment.addPosition')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
