'use client';
// Живое обновление рейтинга на публичной странице турнира (фаза 13): после расчёта рейтинга по схватке канал турнира
// сообщает тему `rating`, и страница перечитывается с сервера web (его кэш публичных ответов к этому времени
// сброшен тем же событием). Пауза — чтобы сброс кэша сервера успел прийти раньше запроса страницы и чтобы
// несколько расчётов подряд (схватки на разных коврах) дали одно обновление.
import { liveChannel, type LiveChangedPayload } from '@sde/contracts';
import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useLiveChannel } from '@/lib/live';

const REFRESH_DELAY_MS = 1_500;

export function RatingLiveRefresh({ slug }: { slug: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribed = useRef(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLiveChannel(liveChannel.publicCompetition(slug), (e) => {
    if (e.kind === 'error') return;
    if (e.kind === 'resync') {
      // Первая подписка — страница только что отрисована; повторная (после обрыва) — изменения могли быть пропущены.
      const first = !subscribed.current;
      subscribed.current = true;
      if (first) return;
    } else if (!(e.message.payload as LiveChangedPayload).topics.includes('rating')) return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, REFRESH_DELAY_MS);
  });
  return null;
}
