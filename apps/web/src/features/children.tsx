'use client';
// Кабинет законного представителя и спортсмена (API.md, 4.2): «мои спортсмены», статус согласий.
import { CONSENT_KINDS, type MyAthlete } from '@sde/contracts';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { QueryState } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { useMe, useMyAthletes } from '@/lib/queries';

export function MyAthletes() {
  const t = useTranslations();
  const { data: me } = useMe();
  const query = useMyAthletes();
  return (
    <>
      <PageHeader title={t('children.title')} description={t('children.hint')} />
      {!me?.personId ? (
        <Alert tone="info" className="mb-4">
          {t('children.noPerson')}{' '}
          <Link href="/account" className="font-medium underline">
            {t('nav.account')}
          </Link>
        </Alert>
      ) : null}
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          (query.data ?? []).length === 0 ? (
            <EmptyState title={t('children.empty')}>{t('children.emptyHint')}</EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {(query.data ?? []).map((a) => (
                <MyAthleteCard key={`${a.relation}-${a.athleteId}`} athlete={a} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}

function MyAthleteCard({ athlete: a }: { athlete: MyAthlete }) {
  const t = useTranslations();
  const open = a.relation === 'SELF' || a.verified;
  const missing = a.consentsStatus ? CONSENT_KINDS.filter((k) => a.consentsStatus?.[k] === 'MISSING') : [];
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{a.publicName}</h2>
          <Badge tone="info">{t(`athletes.relation.${a.relation}`)}</Badge>
          {a.relation === 'GUARDIAN' ? (
            a.verified ? (
              <Badge tone="success">
                <span aria-hidden="true">●</span> {t('guardians.verified')}
              </Badge>
            ) : (
              <Badge tone="warning">
                <span aria-hidden="true">◐</span> {t('guardians.notVerified')}
              </Badge>
            )
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {a.birthYear} · {a.clubShortName ?? t('athletes.noClub')}
        </p>
        {!open ? <p className="mt-3 text-sm text-slate-700">{t('children.waitVerification')}</p> : null}
        {a.consentsStatus ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {CONSENT_KINDS.map((k) => (
              <li key={k}>
                <Badge tone={a.consentsStatus?.[k] === 'GIVEN' ? 'success' : 'warning'}>
                  <span aria-hidden="true">{a.consentsStatus?.[k] === 'GIVEN' ? '●' : '◐'}</span>
                  {t(`consents.kinds.${k}`)}: {t(`consents.states.${a.consentsStatus?.[k] ?? 'MISSING'}`)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {open ? (
          <Link
            href={`/athletes/${a.athleteId}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
          >
            {missing.length > 0 ? t('children.giveConsents') : t('children.open')}
          </Link>
        ) : null}
      </Card>
    </li>
  );
}
