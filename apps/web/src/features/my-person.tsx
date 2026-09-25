'use client';
// «Мои данные» (API.md, 3.2): запись «человек» пользователя — нужна тренеру, судье и представителю.
import { type DataEnvelope, type PersonDto } from '@sde/contracts';
import { Alert, Button, Card, CardTitle } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  emptyPerson,
  fieldErrors,
  PersonFields,
  personPayload,
  type PersonValues,
} from '@/components/person-fields';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useAction } from '@/lib/use-action';

export function MyPersonCard() {
  const t = useTranslations('account.person');
  const queryClient = useQueryClient();
  const person = useQuery({
    queryKey: ['me', 'person'],
    queryFn: async () => (await api<DataEnvelope<PersonDto | null>>('/me/person')).data,
  });
  const [value, setValue] = useState<PersonValues>(emptyPerson());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    const p = person.data;
    if (p)
      setValue({
        lastName: p.lastName,
        firstName: p.firstName,
        middleName: p.middleName ?? '',
        birthDate: p.birthDate,
        gender: p.gender,
      });
  }, [person.data]);

  const save = async (confirmNotDuplicate: boolean): Promise<void> => {
    setErrors({});
    setSaved(false);
    await action.run(async () => {
      try {
        await api('/me/person', {
          method: 'PUT',
          body: { ...personPayload(value), ...(confirmNotDuplicate ? { confirmNotDuplicate } : {}) },
        });
        setDuplicate(false);
        setSaved(true);
        await queryClient.invalidateQueries({ queryKey: ['me'] });
        await queryClient.invalidateQueries({ queryKey: qk.me });
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
    <Card className="xl:col-span-2">
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-4 text-sm text-slate-600">{t('hint')}</p>
      {saved ? (
        <Alert tone="success" className="mb-4">
          {t('saved')}
        </Alert>
      ) : null}
      {action.error && Object.keys(errors).length === 0 ? (
        <Alert tone="danger" className="mb-4">
          {action.error}
        </Alert>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
        className="space-y-4"
      >
        <PersonFields idPrefix="me-person" value={value} onChange={setValue} errors={errors} />
        {duplicate ? (
          <Alert tone="warning">
            {t('duplicate')}
            <div className="mt-3">
              <Button type="button" variant="secondary" loading={action.busy} onClick={() => void save(true)}>
                {t('notMe')}
              </Button>
            </div>
          </Alert>
        ) : null}
        <Button type="submit" loading={action.busy}>
          {t('save')}
        </Button>
      </form>
    </Card>
  );
}
