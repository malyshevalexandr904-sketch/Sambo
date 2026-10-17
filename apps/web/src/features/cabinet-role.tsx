'use client';
// Роль в кабинете (0.13.0): человек с несколькими ролями работает в одной выбранной — права на сервере, меню и обзор
// действуют только для неё. Переключатель — в боковой панели; выбор хранится на сервере на сессию входа, поэтому
// после переключения страница загружается заново (кэш запросов, соединение живых данных, другие вкладки).
import { type CabinetRole, type DataEnvelope, type Me } from '@sde/contracts';
import { Alert, Button, Select } from '@sde/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useErrorMessage } from '@/lib/errors';

const CHANNEL = 'sde-cabinet-role';

interface RoleMessage {
  userId: string;
  role: CabinetRole;
}

function announce(msg: RoleMessage): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    // BroadcastChannel недоступен (старый браузер) — другие вкладки узнают о смене при следующем запросе.
  }
}

/**
 * Переключение роли. `then`: `home` — открыть обзор новой роли, `stay` — перезагрузить текущую страницу (она могла
 * быть недоступна в прежней роли). Страница загружается заново целиком: права изменились у всей вкладки.
 */
export function useSwitchRole(): {
  switchTo: (role: CabinetRole, then?: 'home' | 'stay') => Promise<void>;
  busy: boolean;
  error: string | null;
} {
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchTo = async (role: CabinetRole, then: 'home' | 'stay' = 'home'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DataEnvelope<Me>>('/me/role', { method: 'PUT', body: { role } });
      announce({ userId: res.data.id, role });
      if (then === 'stay') window.location.reload();
      else window.location.assign(`/${locale}/admin`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return { switchTo, busy, error };
}

/** Роль сменили в другой вкладке этого браузера: здесь она уже действует — предлагаем обновить страницу. */
export function RoleChangedElsewhere({ userId }: { userId: string }) {
  const t = useTranslations('cabinetRole');
  const [role, setRole] = useState<CabinetRole | null>(null);
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (e: MessageEvent<RoleMessage>) => {
        if (e.data?.userId === userId) setRole(e.data.role);
      };
    } catch {
      ch = null;
    }
    return () => ch?.close();
  }, [userId]);
  if (!role) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <span>{t('changedElsewhere', { role: t(`roles.${role}`) })}</span>
        <Button size="sm" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      </div>
    </div>
  );
}

/** Переключатель в боковой панели: текущая роль, другие роли пользователя, «Добавить роль». */
export function RoleSwitcher({ me }: { me: Me }) {
  const t = useTranslations('cabinetRole');
  const id = useId();
  const { switchTo, busy, error } = useSwitchRole();
  const roles = me.availableRoles;
  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {roles.length === 0 ? (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('label')}</p>
          <p className="mt-1 text-sm text-slate-700">{t('none')}</p>
        </>
      ) : roles.length === 1 ? (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('label')}</p>
          <p className="mt-1 font-semibold text-slate-900">{t(`roles.${roles[0]!}`)}</p>
        </>
      ) : (
        <>
          <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('label')}
          </label>
          <Select
            id={id}
            className="mt-1 w-full"
            value={me.activeRole ?? ''}
            disabled={busy}
            aria-describedby={`${id}-hint`}
            onChange={(e) => void switchTo(e.target.value as CabinetRole)}
          >
            {me.activeRole === null ? <option value="">{t('choose')}</option> : null}
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
          <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
            {t('hint')}
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Link
        href="/onboarding"
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline"
      >
        {roles.length === 0 ? t('chooseRole') : t('addRole')}
      </Link>
    </div>
  );
}

/**
 * Подсказка на «нет доступа» и «не найдено»: страница может быть доступна в другой роли пользователя (например,
 * уведомление о ребёнке открыто в роли тренера). Данные «я» берутся из кэша — на публичных страницах запроса нет.
 */
export function OtherRolesHint({ error }: { error: unknown }) {
  const t = useTranslations('cabinetRole');
  const queryClient = useQueryClient();
  const me = queryClient.getQueryData<Me>(qk.me);
  const { switchTo, busy } = useSwitchRole();
  if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404) || !me) return null;
  const others = me.availableRoles.filter((r) => r !== me.activeRole);
  if (others.length === 0) return null;
  return (
    <Alert tone="info" className="mt-3">
      <p>{t('otherRoles', { role: me.activeRole ? t(`roles.${me.activeRole}`) : t('noRole') })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {others.map((r) => (
          <Button
            key={r}
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => void switchTo(r, 'stay')}
          >
            {t('openAs', { role: t(`roles.${r}`) })}
          </Button>
        ))}
      </div>
    </Alert>
  );
}
