'use client';
// Спортсмены (API.md, 4.1): список по видимости — сервер отдаёт только спортсменов клубов пользователя.
import { type AthleteSummary, GENDERS, type Page, PROFILE_STATUSES } from '@sde/contracts';
import { Button, EmptyState, Input, PageHeader, Select, Table, Td, Th } from '@sde/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import { Link } from '@/i18n/navigation';
import { hasAnywhere } from '@/lib/access';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useRankName } from './shared';
import { qk, useMe } from '@/lib/queries';

const linkButton =
  'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

export function AthletesList() {
  const t = useTranslations();
  const locale = useLocale();
  const { data: me } = useMe();
  const rankName = useRankName();
  const isCoach = !!me?.grants.organizations.some((g) => g.roles.includes('COACH'));
  const [draft, setDraft] = useState({
    q: '',
    gender: '',
    birthYear: '',
    status: '',
    mine: isCoach ? 'true' : '',
  });
  const [filters, setFilters] = useState(draft);
  const query = useInfiniteQuery({
    queryKey: qk.athletes(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<AthleteSummary>>('/athletes', { query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader
        title={t('athletes.title')}
        description={t('athletes.listHint')}
        actions={
          <>
            {hasAnywhere(me, 'athlete.import') ? (
              <Link
                href="/athletes/import"
                className={`${linkButton} border border-slate-300 hover:bg-slate-50`}
              >
                {t('athletes.import')}
              </Link>
            ) : null}
            {hasAnywhere(me, 'athlete.create') ? (
              <Link href="/athletes/new" className={`${linkButton} bg-blue-700 text-white hover:bg-blue-800`}>
                {t('athletes.create')}
              </Link>
            ) : null}
          </>
        }
      />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <label className="sr-only" htmlFor="athlete-q">
          {t('common.search')}
        </label>
        <Input
          id="athlete-q"
          className="sm:col-span-2 lg:col-span-3"
          placeholder={t('athletes.searchPlaceholder')}
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <Input
          aria-label={t('athletes.birthYear')}
          placeholder={t('athletes.birthYear')}
          inputMode="numeric"
          className="lg:col-span-1"
          value={draft.birthYear}
          onChange={(e) => setDraft({ ...draft, birthYear: e.target.value.replace(/\D/g, '').slice(0, 4) })}
        />
        <Select
          className="lg:col-span-2"
          aria-label={t('people.gender')}
          value={draft.gender}
          onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
        >
          <option value="">
            {t('people.gender')}: {t('common.all')}
          </option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {t(`people.genders.${g}`)}
            </option>
          ))}
        </Select>
        <Select
          className="lg:col-span-2"
          aria-label={t('common.status')}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">{t('athletes.statusCurrent')}</option>
          {PROFILE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        {isCoach ? (
          <Select
            className="lg:col-span-2"
            aria-label={t('athletes.scope')}
            value={draft.mine}
            onChange={(e) => setDraft({ ...draft, mine: e.target.value })}
          >
            <option value="true">{t('athletes.mine')}</option>
            <option value="">{t('athletes.allOfClub')}</option>
          </Select>
        ) : null}
        <Button type="submit" className="justify-self-start">
          {t('common.apply')}
        </Button>
      </form>
      <QueryState isPending={query.isPending} error={query.error}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('common.noData')}>{t('athletes.empty')}</EmptyState>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('athletes.name')}</Th>
                    <Th>{t('people.birthDate')}</Th>
                    <Th>{t('athletes.club')}</Th>
                    <Th>{t('athletes.coach')}</Th>
                    <Th>{t('athletes.rank')}</Th>
                    <Th>{t('common.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <Td>
                        <Link
                          href={`/athletes/${a.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {a.lastName} {a.firstName} {a.middleName ?? ''}
                        </Link>
                      </Td>
                      <Td>{formatDate(a.birthDate, locale)}</Td>
                      <Td>{a.club?.shortName ?? '—'}</Td>
                      <Td>{a.coach?.name ?? '—'}</Td>
                      <Td>{rankName(a.rankCode)}</Td>
                      <Td>
                        <StatusBadge status={a.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {query.hasNextPage ? (
                <Button
                  variant="secondary"
                  className="mt-4"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </>
  );
}
