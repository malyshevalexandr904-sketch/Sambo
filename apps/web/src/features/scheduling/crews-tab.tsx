'use client';
// Вкладка «Бригады» (план Phase 6, §5; D-07): по сессии и ковру — 6 должностей, персонал турнира
// (судьи, гл. судья, секретари). Право — mat_assignment.manage (TOURNAMENT_MANAGER, CHIEF_REFEREE).
import { type Competition, MAT_CREW_ROLES, type MatCrewRole } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Select } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { useCrewCandidates, useCrews, useInvalidateScheduling, useMats, useSessions } from './shared';

function MatCrewCard({
  competitionId,
  sessionId,
  matId,
  matLabel,
  canManage,
  assignments,
  candidates,
  onDone,
}: {
  competitionId: string;
  sessionId: string;
  matId: string;
  matLabel: string;
  canManage: boolean;
  assignments: { role: MatCrewRole; userId: string | null }[];
  candidates: { id: string; displayName: string }[];
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('scheduling.crews');
  const [form, setForm] = useState<Record<MatCrewRole, string>>(
    Object.fromEntries(
      MAT_CREW_ROLES.map((r) => [r, assignments.find((a) => a.role === r)?.userId ?? '']),
    ) as Record<MatCrewRole, string>,
  );
  const action = useAction();
  return (
    <Card>
      <CardTitle>{matLabel}</CardTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        {MAT_CREW_ROLES.map((role) => (
          <Field key={role} id={`crew-${sessionId}-${matId}-${role}`} label={t(`roles.${role}`)}>
            <Select
              id={`crew-${sessionId}-${matId}-${role}`}
              disabled={!canManage}
              value={form[role]}
              onChange={(e) => setForm({ ...form, [role]: e.target.value })}
            >
              <option value="">{t('unassigned')}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      {action.error ? (
        <Alert tone="danger" className="mt-2">
          {action.error}
        </Alert>
      ) : null}
      {canManage ? (
        <Button
          className="mt-3"
          size="sm"
          loading={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/competitions/${competitionId}/mat-assignments`, {
                method: 'PUT',
                body: {
                  sessionId,
                  matId,
                  assignments: MAT_CREW_ROLES.map((role) => ({ role, userId: form[role] || null })),
                },
              });
              await onDone();
            })
          }
        >
          {t('save')}
        </Button>
      ) : null}
    </Card>
  );
}

export function CrewsTab({ competition }: { competition: Competition }) {
  const t = useTranslations('scheduling.crews');
  const matsQuery = useMats(competition.id);
  const sessionsQuery = useSessions(competition.id);
  const crewsQuery = useCrews(competition.id);
  const candidatesQuery = useCrewCandidates(competition.id);
  const invalidate = useInvalidateScheduling(competition.id);
  const canManage = competition.allowedActions.includes('mat_assignment.manage');
  const copyAction = useAction();
  return (
    <QueryState
      isPending={matsQuery.isPending || sessionsQuery.isPending || crewsQuery.isPending || candidatesQuery.isPending}
      error={matsQuery.error ?? sessionsQuery.error ?? crewsQuery.error ?? candidatesQuery.error}
    >
      {() => {
        const mats = matsQuery.data ?? [];
        const sessions = [...(sessionsQuery.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const assignments = crewsQuery.data ?? [];
        const candidates = candidatesQuery.data ?? [];
        if (sessions.length === 0 || mats.length === 0) return <EmptyState title={t('empty')} />;
        return (
          <div className="space-y-6">
            {sessions.map((session, i) => {
              const prev = sessions[i - 1];
              return (
                <div key={session.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{session.name}</h3>
                    {canManage && prev ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={copyAction.busy}
                        onClick={() =>
                          void copyAction.run(async () => {
                            await api(`/competitions/${competition.id}/mat-assignments/copy`, {
                              method: 'POST',
                              body: { fromSessionId: prev.id, toSessionId: session.id },
                            });
                            await invalidate();
                          })
                        }
                      >
                        {t('copyFromPrevious')}
                      </Button>
                    ) : null}
                  </div>
                  {copyAction.error ? <Alert tone="danger">{copyAction.error}</Alert> : null}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {mats.map((mat) => (
                      <MatCrewCard
                        key={mat.id}
                        competitionId={competition.id}
                        sessionId={session.id}
                        matId={mat.id}
                        matLabel={`№${mat.number} ${mat.name ?? ''}`}
                        canManage={canManage}
                        assignments={assignments
                          .filter((a) => a.sessionId === session.id && a.matId === mat.id)
                          .map((a) => ({ role: a.role, userId: a.user.id }))}
                        candidates={candidates}
                        onDone={invalidate}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }}
    </QueryState>
  );
}
