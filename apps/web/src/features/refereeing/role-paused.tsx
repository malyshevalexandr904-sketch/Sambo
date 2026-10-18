'use client';
// Пауза очереди оценок планшета (0.13.1): в этой сессии выбрали другую роль кабинета.
import { type CabinetRole, type Me } from '@sde/contracts';
import { Alert, Button } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRoleBroadcast, useSwitchRole } from '@/features/cabinet-role';
import { qk } from '@/lib/queries';

/**
 * В этой сессии выбрали другую роль кабинета (0.13.1) — сервер не принимает оценки, но они не потеряны: очередь
 * ждёт. Возврат роли — кнопкой (без перезагрузки страницы: она спросила бы «Покинуть страницу?» из-за очереди)
 * или в другой вкладке браузера — очередь продолжает отправку сама.
 */
export function RolePaused({
  count,
  role,
  onResumed,
}: {
  count: number;
  role: CabinetRole;
  onResumed: () => void;
}) {
  const t = useTranslations('referee');
  const tRoles = useTranslations('cabinetRole.roles');
  const me = useQueryClient().getQueryData<Me>(qk.me);
  const { switchTo, busy, error } = useSwitchRole();
  useRoleBroadcast(me?.id ?? null, (r) => {
    if (r === role) onResumed();
  });
  return (
    <Alert tone="danger" title={t('rolePausedTitle')}>
      <p>{t('rolePaused', { count, role: tRoles(role) })}</p>
      <Button
        className="mt-3"
        loading={busy}
        onClick={() => void switchTo(role, 'none').then((ok) => (ok ? onResumed() : undefined))}
      >
        {t('backToRole', { role: tRoles(role) })}
      </Button>
      {error ? <p className="mt-2 text-sm">{error}</p> : null}
    </Alert>
  );
}
