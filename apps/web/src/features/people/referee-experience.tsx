'use client';
// Судейский стаж в «Настройках» (правки 07.11.2026, п. 10): судья указывает год начала практики, стаж на его
// странице считается от него. Карточка видна, только если у пользователя есть профиль судьи.
import type { DataEnvelope, Me, RefereeStatsDto } from '@sde/contracts';
import { Alert, Button, Card, CardTitle, Field, Input } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';
import { usePersonProfile } from './user-page';

export function RefereeExperienceCard({ me }: { me: Me }) {
  const t = useTranslations('directory.referee');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const profile = usePersonProfile(me.personId ? me.id : undefined);
  const referee = profile.data?.referee;
  const [year, setYear] = useState('');
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => setYear(referee?.sinceYear ? String(referee.sinceYear) : ''), [referee?.sinceYear]);
  if (!referee || referee.categoryCode === null) return null;
  return (
    <Card>
      <CardTitle>{t('experienceTitle')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('experienceHint')}</p>
      {action.error ? (
        <Alert tone="danger" className="mb-3">
          {action.error}
        </Alert>
      ) : saved ? (
        <Alert tone="success" className="mb-3">
          {tc('saved')}
        </Alert>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void action.run(async () => {
            await api<DataEnvelope<RefereeStatsDto>>('/me/referee-experience', {
              method: 'PUT',
              body: { sinceYear: year.trim() === '' ? null : Number(year) },
            });
            await queryClient.invalidateQueries({ queryKey: ['people', me.id] });
            setSaved(true);
          });
        }}
      >
        <Field id="referee-since" label={t('sinceYear')}>
          <Input
            id="referee-since"
            type="number"
            inputMode="numeric"
            min={1950}
            max={new Date().getFullYear()}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-32"
          />
        </Field>
        <Button type="submit" loading={action.busy}>
          {t('save')}
        </Button>
      </form>
    </Card>
  );
}
