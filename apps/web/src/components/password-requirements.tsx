'use client';
// Требования к паролю — видны сразу, до ввода, и отмечаются по мере набора (те же правила, что Password в
// @sde/contracts; распространённые пароли сервер проверяет по базе утечек).
import { useTranslations } from 'next-intl';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function PasswordRequirements({ id, value }: { id: string; value: string }) {
  const t = useTranslations('auth.passwordRules');
  const rules = [
    { key: 'length', ok: value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX },
    { key: 'common', ok: null },
  ] as const;
  return (
    <div id={id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-800">{t('title')}</p>
      <ul className="mt-1 space-y-1">
        {rules.map((r) => (
          <li key={r.key} className={r.ok ? 'flex gap-2 text-green-800' : 'flex gap-2 text-slate-600'}>
            <span aria-hidden="true">{r.ok ? '✓' : '•'}</span>
            <span>
              {t(r.key, { min: PASSWORD_MIN, max: PASSWORD_MAX })}
              {r.ok ? <span className="sr-only"> — {t('done')}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
