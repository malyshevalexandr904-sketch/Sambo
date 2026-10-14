'use client';
// «Уведомлять о схватках» в карточке спортсмена (Phase 8b; API.md, 5.8): подписка тренера или руководителя клуба —
// уведомления дня соревнований о схватках спортсмена. Представители и сам спортсмен получают их без подписки.
import type { DataEnvelope, FollowStateDto } from '@sde/contracts';
import { Button } from '@sde/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

export function FollowButton({ athleteId }: { athleteId: string }) {
  const t = useTranslations('athletes.follow');
  const queryClient = useQueryClient();
  const action = useAction();
  const key = ['athletes', athleteId, 'follow'];
  const state = useQuery({
    queryKey: key,
    queryFn: async () => (await api<DataEnvelope<FollowStateDto>>(`/athletes/${athleteId}/follow`)).data,
  });
  if (!state.data) return null;
  const following = state.data.following;
  const hintId = `follow-hint-${athleteId}`;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {/* Переключатель: подпись постоянная, состояние — aria-pressed и отметка (скринридер не слышит его дважды). */}
      <Button
        size="sm"
        variant={following ? 'primary' : 'secondary'}
        aria-pressed={following}
        aria-describedby={hintId}
        loading={action.busy}
        onClick={() =>
          void action.run(async () => {
            const r = await api<DataEnvelope<FollowStateDto>>(`/athletes/${athleteId}/follow`, {
              method: following ? 'DELETE' : 'PUT',
            });
            queryClient.setQueryData(key, r.data);
          })
        }
      >
        <span aria-hidden="true">{following ? '✓ ' : ''}</span>
        {t('follow')}
      </Button>
      <span id={hintId} className="max-w-xs text-right text-xs text-slate-500">
        {t('hint')}
      </span>
      {action.error ? <span className="text-xs text-red-700">{action.error}</span> : null}
    </span>
  );
}
