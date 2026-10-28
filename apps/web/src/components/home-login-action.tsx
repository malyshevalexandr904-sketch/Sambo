'use client';
// Кнопка карточки входа на первом экране (0.13.0): вошедшему пользователю — сразу кабинет (отдельной ссылки
// «Перейти в кабинет» больше нет). Сессию проверяем, только если браузер уже работал с сайтом (есть CSRF-cookie):
// у нового гостя лишних запросов нет.
import { COOKIE_CSRF, type DataEnvelope, type Me } from '@sde/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export function HomeLoginAction() {
  const t = useTranslations('home');
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_CSRF}=`))) return;
    let alive = true;
    // Демо-вход — не вход: из демо можно войти своей учётной записью.
    api<DataEnvelope<Me>>('/me')
      .then((res) => alive && setSignedIn(!res.data.demo))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Link
      href={signedIn ? '/admin' : '/login'}
      className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 font-medium text-white hover:bg-blue-800"
    >
      {signedIn ? t('openCabinet') : t('login')}
    </Link>
  );
}
