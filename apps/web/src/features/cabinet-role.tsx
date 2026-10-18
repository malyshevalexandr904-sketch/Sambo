'use client';
// Роль в кабинете (0.13.0): человек с несколькими ролями работает в одной выбранной — права на сервере, меню и обзор
// действуют только для неё. Переключатель — в боковой панели; выбор хранится на сервере на сессию входа, поэтому
// после переключения страница загружается заново (кэш запросов, соединение живых данных, другие вкладки).
import { type CabinetRole, type DataEnvelope, type Me } from '@sde/contracts';
import { Alert, Button, cn } from '@sde/ui';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useErrorMessage } from '@/lib/errors';

const CHANNEL = 'sde-cabinet-role';
/** Эта вкладка сама выбрала роль без перезагрузки (планшет): сообщение о роли из другой вкладки устарело. */
const LOCAL_SWITCH_EVENT = 'sde-cabinet-role-local';
/** Вкладка-отправитель: BroadcastChannel доставляет сообщение и другим объектам канала этой же вкладки. */
const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

interface RoleMessage {
  userId: string;
  role: CabinetRole | null;
  tabId: string;
}

function announce(msg: Omit<RoleMessage, 'tabId'>): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ ...msg, tabId: TAB_ID } satisfies RoleMessage);
    ch.close();
  } catch {
    // BroadcastChannel недоступен (старый браузер) — другие вкладки узнают о смене при следующем запросе.
  }
}

/**
 * Роль сессии до действия, которое может её сменить на сервере (принять приглашение, создать организацию):
 * из кэша «я» или запросом; не вошёл — undefined.
 */
export async function roleBefore(queryClient: QueryClient): Promise<CabinetRole | null | undefined> {
  const cached = queryClient.getQueryData<Me>(qk.me);
  if (cached) return cached.activeRole;
  try {
    return (await api<DataEnvelope<Me>>('/me')).data.activeRole;
  } catch {
    return undefined;
  }
}

/**
 * После такого действия (0.13.1): если сервер перевёл сессию в другую роль, данные прежней роли из кэша убираются
 * (открытые экраны загружают их заново), другие вкладки получают предупреждение. Живое соединение переподключится
 * само: сервер шлёт соединениям сессии `expired`, клиент подписывается заново уже с новой ролью. Возвращает «я».
 */
export async function afterServerRoleChange(
  queryClient: QueryClient,
  before: CabinetRole | null | undefined,
): Promise<Me | null> {
  let fresh: Me;
  try {
    fresh = (await api<DataEnvelope<Me>>('/me')).data;
  } catch {
    return null;
  }
  if (before !== undefined && before !== fresh.activeRole) {
    await queryClient.resetQueries();
    announce({ userId: fresh.id, role: fresh.activeRole });
  }
  queryClient.setQueryData(qk.me, fresh);
  return fresh;
}

/**
 * Переключение роли. `then`: `home` — открыть обзор новой роли, `stay` — перезагрузить текущую страницу (она могла
 * быть недоступна в прежней роли): страница загружается заново целиком — права изменились у всей вкладки;
 * `none` — без перезагрузки (планшет: очередь оценок продолжает отправку), «я» в кэше обновляется. Итог — удалось ли.
 */
export function useSwitchRole(): {
  switchTo: (role: CabinetRole, then?: 'home' | 'stay' | 'none') => Promise<boolean>;
  busy: boolean;
  error: string | null;
} {
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchTo = async (role: CabinetRole, then: 'home' | 'stay' | 'none' = 'home'): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DataEnvelope<Me>>('/me/role', { method: 'PUT', body: { role } });
      announce({ userId: res.data.id, role });
      if (then === 'none') {
        queryClient.setQueryData(qk.me, res.data);
        window.dispatchEvent(new Event(LOCAL_SWITCH_EVENT));
        setBusy(false);
      } else if (then === 'stay') window.location.reload();
      else window.location.assign(`/${locale}/admin`);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return false;
    }
  };
  return { switchTo, busy, error };
}

/** Смена роли в другой вкладке этого браузера (своя вкладка свои сообщения не получает). */
export function useRoleBroadcast(userId: string | null, onRole: (role: CabinetRole | null) => void): void {
  const handler = useRef(onRole);
  handler.current = onRole;
  useEffect(() => {
    if (!userId) return;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (e: MessageEvent<RoleMessage>) => {
        if (e.data?.userId === userId && e.data.tabId !== TAB_ID) handler.current(e.data.role);
      };
    } catch {
      ch = null;
    }
    return () => ch?.close();
  }, [userId]);
}

/** Роль сменили в другой вкладке этого браузера: здесь она уже действует — предлагаем обновить страницу. */
export function RoleChangedElsewhere({ userId }: { userId: string }) {
  const t = useTranslations('cabinetRole');
  const [role, setRole] = useState<CabinetRole | 'none' | null>(null);
  useRoleBroadcast(userId, (r) => setRole(r ?? 'none'));
  useEffect(() => {
    const clear = (): void => setRole(null);
    window.addEventListener(LOCAL_SWITCH_EVENT, clear);
    return () => window.removeEventListener(LOCAL_SWITCH_EVENT, clear);
  }, []);
  if (!role) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <span>{t('changedElsewhere', { role: role === 'none' ? t('noRole') : t(`roles.${role}`) })}</span>
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
          {/* Кнопки, а не выпадающий список (0.13.1): роль меняется только явным нажатием — стрелка клавиатуры на
              закрытом списке не должна переключать права и перезагружать страницу; длинные названия переносятся. */}
          <p id={id} className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('label')}
          </p>
          <div role="group" aria-labelledby={id} aria-describedby={`${id}-hint`}>
            <ul className="mt-1 space-y-1">
              {roles.map((r) => {
                const current = r === me.activeRole;
                return (
                  <li key={r}>
                    <button
                      type="button"
                      aria-pressed={current}
                      disabled={busy}
                      onClick={() => (current ? undefined : void switchTo(r))}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600',
                        current
                          ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-blue-600'
                          : 'text-slate-700 hover:bg-white disabled:text-slate-400',
                      )}
                    >
                      <span aria-hidden="true" className={current ? 'text-blue-700' : 'text-slate-400'}>
                        {current ? '●' : '○'}
                      </span>
                      {t(`roles.${r}`)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
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

/**
 * Полноэкранные экраны без меню (планшет ковра, протоколы; 0.13.1): у кого несколько ролей — узкая строка с текущей
 * ролью и переходом в другие (переключателя меню здесь нет). Печать её не показывает.
 */
export function ConsoleRoleBar({ me }: { me: Me }) {
  const t = useTranslations('cabinetRole');
  const { switchTo, busy } = useSwitchRole();
  if (me.availableRoles.length < 2) return null;
  const others = me.availableRoles.filter((r) => r !== me.activeRole);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-sm print:hidden">
      <span>
        {t('label')}: <strong>{me.activeRole ? t(`roles.${me.activeRole}`) : t('noRole')}</strong>
      </span>
      {others.map((r) => (
        <Button key={r} size="sm" variant="secondary" loading={busy} onClick={() => void switchTo(r, 'stay')}>
          {t('openAs', { role: t(`roles.${r}`) })}
        </Button>
      ))}
    </div>
  );
}
