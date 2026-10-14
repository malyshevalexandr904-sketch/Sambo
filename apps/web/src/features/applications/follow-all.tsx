'use client';
// «Уведомлять о схватках всех спортсменов заявки» (Phase 8b; API.md, 5.8): подписка клуба заявки на одобренных
// спортсменов разом — уведомления дня соревнований (скоро выступает, началась, изменилось время).
import type { ApplicationDto, ApplicationFollowResultDto, DataEnvelope } from '@sde/contracts';
import { Alert, Button, Card, CardTitle } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

export function FollowAllCard({ application: a }: { application: ApplicationDto }) {
  const t = useTranslations('applications.follow');
  const action = useAction();
  const [result, setResult] = useState<ApplicationFollowResultDto | null>(null);
  const press = (follow: boolean): void =>
    void action.run(async () => {
      const r = await api<DataEnvelope<ApplicationFollowResultDto>>(`/applications/${a.id}/follow`, {
        method: 'POST',
        body: { follow },
      });
      setResult(r.data);
    });
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-slate-600">{t('hint')}</p>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {result ? (
        <p className="mb-3 text-sm" role="status">
          {t('result', { following: result.following, total: result.total })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={action.busy} onClick={() => press(true)}>
          {t('followAll')}
        </Button>
        <Button variant="secondary" disabled={action.busy} onClick={() => press(false)}>
          {t('unfollowAll')}
        </Button>
      </div>
    </Card>
  );
}
