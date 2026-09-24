// Локали и маршрутизация (ADR-17): /{locale}/…, ru по умолчанию.
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
