'use client';
// Турнир глазами вошедшего пользователя (публичная страница): подписка на регистрацию, роль, право подать заявку.
// Сессию проверяем, только если браузер уже работал с сайтом (есть CSRF-cookie): у гостя лишних запросов нет.
import { COOKIE_CSRF, type Competition, type DataEnvelope } from '@sde/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

const hasSessionCookie = (): boolean =>
  typeof document !== 'undefined' && document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_CSRF}=`));

export function useViewerCompetition(slug: string) {
  return useQuery({
    queryKey: ['competitions', 'slug', slug],
    queryFn: async (): Promise<Competition | null> => {
      if (!hasSessionCookie()) return null;
      try {
        return (await api<DataEnvelope<Competition>>(`/competitions/slug/${slug}`)).data;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}
