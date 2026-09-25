'use client';
// Судьи и судейские категории (API.md, 4.3): реестр ведут федерации и платформа.
import { type DataEnvelope, PROFILE_STATUSES, type Page, type RefereeSummary } from '@sde/contracts';
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@sde/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryState, StatusBadge } from '@/components/common';
import {
  emptyPerson,
  fieldErrors,
  PersonFields,
  personPayload,
  type PersonValues,
  withPrefix,
} from '@/components/person-fields';
import { api, ApiError } from '@/lib/api';
import { useFieldMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { pickName, qk, useRefereeCategories } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function Referees() {
  const t = useTranslations();
  const locale = useLocale();
  const categories = useRefereeCategories();
  const [draft, setDraft] = useState({ q: '', categoryCode: '', status: 'ACTIVE' });
  const [filters, setFilters] = useState(draft);
  const query = useInfiniteQuery({
    queryKey: qk.referees(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<Page<RefereeSummary>>('/referees', { query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('referees.title')} description={t('referees.hint')} />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <Input
          aria-label={t('common.search')}
          placeholder={t('referees.searchPlaceholder')}
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <Select
          aria-label={t('referees.category')}
          value={draft.categoryCode}
          onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value })}
        >
          <option value="">
            {t('referees.category')}: {t('common.all')}
          </option>
          {(categories.data ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {pickName(c.name, locale)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('common.status')}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          {PROFILE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit">{t('common.apply')}</Button>
      </form>
      <div className="space-y-6">
        <QueryState isPending={query.isPending} error={query.error}>
          {() =>
            rows.length === 0 ? (
              <EmptyState title={t('common.noData')}>{t('referees.empty')}</EmptyState>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('athletes.name')}</Th>
                      <Th>{t('referees.category')}</Th>
                      <Th>{t('referees.assignedAt')}</Th>
                      <Th>{t('common.status')}</Th>
                      <Th>{t('common.actions')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <RefereeRow key={r.id} referee={r} />
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
        <RefereeCreateForm />
      </div>
    </>
  );
}

function RefereeRow({ referee: r }: { referee: RefereeSummary }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useRefereeCategories();
  const [code, setCode] = useState(r.category.code);
  const action = useAction();
  const patch = (body: Record<string, unknown>): void =>
    void action.run(async () => {
      await api<DataEnvelope<RefereeSummary>>(`/referees/${r.id}`, {
        method: 'PATCH',
        version: r.version,
        body,
      });
      await queryClient.invalidateQueries({ queryKey: ['referees'] });
    });
  return (
    <tr>
      <Td className="font-medium">{r.name}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('referees.category')}
            value={code}
            className="min-w-80"
            onChange={(e) => setCode(e.target.value)}
          >
            {(categories.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {pickName(c.name, locale)}
              </option>
            ))}
          </Select>
          {code !== r.category.code ? (
            <Button
              size="sm"
              loading={action.busy}
              onClick={() =>
                patch({
                  refereeCategoryCode: code,
                  categoryAssignedAt: new Date().toISOString().slice(0, 10),
                })
              }
            >
              {t('common.save')}
            </Button>
          ) : null}
        </div>
      </Td>
      <Td>{formatDate(r.categoryAssignedAt, locale)}</Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td>
        <Button
          size="sm"
          variant="ghost"
          loading={action.busy}
          onClick={() => patch({ status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
        >
          {r.status === 'ACTIVE' ? t('coaches.deactivate') : t('coaches.activate')}
        </Button>
        {action.error ? <p className="mt-1 text-sm text-red-700">{action.error}</p> : null}
      </Td>
    </tr>
  );
}

function RefereeCreateForm() {
  const t = useTranslations();
  const tf = useFieldMessage();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const categories = useRefereeCategories();
  const [person, setPerson] = useState<PersonValues>(emptyPerson());
  const [userId, setUserId] = useState('');
  const [category, setCategory] = useState({ code: '', assignedAt: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [done, setDone] = useState(false);
  const action = useAction();
  const submit = (confirm: boolean): void => {
    setErrors({});
    setDone(false);
    void action.run(async () => {
      try {
        const who = userId.trim()
          ? { userId: userId.trim() }
          : { person: personPayload(person), ...(confirm ? { confirmNotDuplicate: true } : {}) };
        await api('/referees', {
          method: 'POST',
          body: {
            ...who,
            refereeCategoryCode: category.code,
            ...(category.assignedAt ? { categoryAssignedAt: category.assignedAt } : {}),
          },
        });
        setDone(true);
        setDuplicate(false);
        setPerson(emptyPerson());
        setUserId('');
        await queryClient.invalidateQueries({ queryKey: ['referees'] });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
          setDuplicate(true);
          return;
        }
        setErrors(fieldErrors(e));
        throw e;
      }
    });
  };
  return (
    <Card className="max-w-3xl">
      <CardTitle>{t('referees.add')}</CardTitle>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        {done ? <Alert tone="success">{t('referees.added')}</Alert> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Field
          id="referee-user"
          label={t('referees.userId')}
          hint={t('referees.userIdHint')}
          error={tf(errors.userId)}
        >
          <Input id="referee-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </Field>
        {!userId.trim() ? (
          <PersonFields
            idPrefix="referee"
            value={person}
            onChange={setPerson}
            errors={withPrefix(errors, 'person.')}
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="referee-category" label={t('referees.category')} error={tf(errors.refereeCategoryCode)}>
            <Select
              id="referee-category"
              value={category.code}
              onChange={(e) => setCategory({ ...category, code: e.target.value })}
            >
              <option value="">—</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {pickName(c.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="referee-assigned" label={t('referees.assignedAt')} error={tf(errors.categoryAssignedAt)}>
            <Input
              id="referee-assigned"
              type="date"
              value={category.assignedAt}
              onChange={(e) => setCategory({ ...category, assignedAt: e.target.value })}
            />
          </Field>
        </div>
        {duplicate ? (
          <Alert tone="warning">
            {t('coaches.duplicate')}
            <div className="mt-3">
              <Button type="button" variant="secondary" loading={action.busy} onClick={() => submit(true)}>
                {t('coaches.createAnyway')}
              </Button>
            </div>
          </Alert>
        ) : null}
        <Button type="submit" loading={action.busy} disabled={!category.code}>
          {t('referees.add')}
        </Button>
      </form>
    </Card>
  );
}
