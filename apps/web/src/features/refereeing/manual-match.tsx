'use client';
// Ручная схватка вне сетки (план Phase 7b, §4; `match.create` — секретарь, руководитель турнира): категория,
// два одобренных участника, подпись круга, длительность, ковёр и сессия — схватка встаёт в конец ковра,
// проводится на планшете как обычная и на места не влияет.
import type { EntryDto, Page } from '@sde/contracts';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '@sde/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState } from '@/components/common';
import { createManualMatch, useCompetitionResults, useInvalidateResults } from '@/features/results/api';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { pickName } from '@/lib/queries';
import { useOfficiating } from './api';
import { useDescribe } from './tablet-parts';

const DURATIONS = [60, 90, 120, 150, 180, 240, 300, 360];
const LINK =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50';

function useCategoryEntries(competitionId: string, categoryId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'entries', { categoryId, status: 'APPROVED', manual: true }],
    enabled: categoryId !== '',
    queryFn: async () =>
      (
        await api<Page<EntryDto>>(`/competitions/${competitionId}/entries`, {
          query: { categoryId, status: 'APPROVED', limit: 100 },
        })
      ).data,
  });
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function ManualMatchForm({ competitionId }: { competitionId: string }) {
  const t = useTranslations('referee.manual');
  const tRef = useTranslations('referee');
  const locale = useLocale();
  const router = useRouter();
  const describe = useDescribe();
  const invalidate = useInvalidateResults();
  const officiating = useOfficiating(competitionId);
  const results = useCompetitionResults(competitionId);
  const [categoryId, setCategoryId] = useState('');
  const [red, setRed] = useState('');
  const [blue, setBlue] = useState('');
  const [label, setLabel] = useState('');
  const [duration, setDuration] = useState(180);
  const [matId, setMatId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = useCategoryEntries(competitionId, categoryId);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('hint')}
        actions={
          <Link href={`/referee/${competitionId}`} className={LINK}>
            {tRef('backToMats')}
          </Link>
        }
      />
      <QueryState
        isPending={officiating.isPending || results.isPending}
        error={officiating.error ?? results.error}
      >
        {() => {
          const o = officiating.data!;
          if (!o.canCreateMatch) return <EmptyState title={t('forbidden')} />;
          const categories = results.data?.categories ?? [];
          const session = sessionId || o.currentSessionId || o.sessions[0]?.id || '';
          const mat = matId || o.mats.find((m) => m.isActive)?.id || '';
          const list = entries.data ?? [];
          const ready =
            categoryId !== '' &&
            red !== '' &&
            blue !== '' &&
            red !== blue &&
            label.trim().length >= 2 &&
            mat !== '' &&
            session !== '' &&
            (reason.trim() === '' || reason.trim().length >= 5);
          const submit = async (): Promise<void> => {
            setBusy(true);
            setError(null);
            try {
              const res = await createManualMatch(categoryId, {
                redEntryId: red,
                blueEntryId: blue,
                label: label.trim(),
                durationSeconds: duration,
                matId: mat,
                sessionId: session,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              });
              await invalidate();
              router.push(`/referee/${competitionId}/matches/${res.data.id}`);
            } catch (e) {
              setError(describe(e));
            } finally {
              setBusy(false);
            }
          };
          return (
            <Card className="max-w-2xl space-y-4">
              <Field id="manual-category" label={t('category')}>
                <Select
                  id="manual-category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setRed('');
                    setBlue('');
                  }}
                >
                  <option value="">{t('choose')}</option>
                  {categories.map((c) => (
                    <option key={c.categoryId} value={c.categoryId}>
                      {pickName(c.categoryName, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              {categoryId && entries.isSuccess && list.length < 2 ? (
                <Alert tone="warning">{t('notEnough')}</Alert>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ['RED', red, setRed, blue],
                    ['BLUE', blue, setBlue, red],
                  ] as const
                ).map(([side, value, set, other]) => (
                  <Field key={side} id={`manual-${side}`} label={tRef(side === 'RED' ? 'red' : 'blue')}>
                    <Select
                      id={`manual-${side}`}
                      value={value}
                      disabled={!categoryId}
                      onChange={(e) => set(e.target.value)}
                      className={
                        side === 'RED' ? 'border-l-4 border-l-red-600' : 'border-l-4 border-l-blue-600'
                      }
                    >
                      <option value="">{t('choose')}</option>
                      {list
                        .filter((x) => x.id !== other)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.publicName}
                            {x.organization ? ` · ${x.organization.name}` : ''}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <Field id="manual-label" label={t('label')} hint={t('labelHint')}>
                <Input
                  id="manual-label"
                  value={label}
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {(['labelRematch', 'labelExhibition'] as const).map((k) => (
                  <Button key={k} size="sm" variant="ghost" onClick={() => setLabel(t(k))}>
                    {t(k)}
                  </Button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="manual-duration" label={t('duration')}>
                  <Select
                    id="manual-duration"
                    value={String(duration)}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {clock(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="manual-mat" label={t('mat')}>
                  <Select id="manual-mat" value={mat} onChange={(e) => setMatId(e.target.value)}>
                    {o.mats.map((m) => (
                      <option key={m.id} value={m.id}>
                        {tRef('matTitle', { number: m.number })} {m.name ?? ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="manual-session" label={t('session')}>
                  <Select id="manual-session" value={session} onChange={(e) => setSessionId(e.target.value)}>
                    {o.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field id="manual-reason" label={t('reason')} hint={t('reasonHint')}>
                <Textarea
                  id="manual-reason"
                  value={reason}
                  rows={2}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Alert tone="info">{t('consequences')}</Alert>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button size="lg" disabled={!ready} loading={busy} onClick={() => void submit()}>
                {t('submit')}
              </Button>
            </Card>
          );
        }}
      </QueryState>
    </>
  );
}
