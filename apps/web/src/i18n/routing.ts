// Локали и маршрутизация (ADR-17): /{locale}/…, ru по умолчанию.
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'always',
  // Правки 07.11.2026, п. 2: выбора языка в интерфейсе нет — всегда русский, язык браузера не учитывается.
  // Английские переводы и адреса /en/… остаются (ссылки из старых писем продолжают открываться).
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
