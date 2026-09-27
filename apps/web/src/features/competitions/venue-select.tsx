'use client';
// Место проведения: выбор из мест организатора и вышестоящих организаций или добавление нового.
import { type DataEnvelope, type VenueDto } from '@sde/contracts';
import { Alert, Button, Field, Input, Select } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function VenueSelect({
  organizationId,
  value,
  timezone,
  error,
  onChange,
}: {
  organizationId: string;
  value: string;
  timezone: string;
  error?: string;
  onChange: (venueId: string) => void;
}) {
  const t = useTranslations('competitions');
  const queryClient = useQueryClient();
  const params = { ownerOrganizationId: organizationId };
  const venues = useQuery({
    queryKey: qk.venues(params),
    queryFn: async () => (await api<DataEnvelope<VenueDto[]>>('/venues', { query: params })).data,
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', city: '', address: '' });
  const action = useAction();
  if (venues.error) return <p className="text-sm text-slate-600">{t('venueNoRights')}</p>;
  return (
    <div className="space-y-3">
      <Field id="c-venue" label={t('venue')} error={error}>
        <Select id="c-venue" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('venueLater')}</option>
          {(venues.data ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.city ? `, ${x.city}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      {!adding ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
          {t('venueAdd')}
        </Button>
      ) : (
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          {action.error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {action.error}
            </Alert>
          ) : null}
          <Field id="v-name" label={t('venueName')} className="sm:col-span-2">
            <Input
              id="v-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field id="v-city" label={t('venueCity')}>
            <Input
              id="v-city"
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            />
          </Field>
          <Field id="v-address" label={t('venueAddress')}>
            <Input
              id="v-address"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="button"
              size="sm"
              loading={action.busy}
              disabled={draft.name.trim().length < 2}
              onClick={() =>
                void action.run(async () => {
                  const res = await api<DataEnvelope<VenueDto>>('/venues', {
                    method: 'POST',
                    body: {
                      ownerOrganizationId: organizationId,
                      name: draft.name.trim(),
                      city: draft.city.trim() || undefined,
                      address: draft.address.trim() || undefined,
                      timezone,
                    },
                  });
                  await queryClient.invalidateQueries({ queryKey: ['venues'] });
                  onChange(res.data.id);
                  setAdding(false);
                  setDraft({ name: '', city: '', address: '' });
                })
              }
            >
              {t('venueSave')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
