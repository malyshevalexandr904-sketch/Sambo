import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Экраны во весь экран без меню (планшет ковра): та же проверка входа, что в кабинете. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <AppShell bare>{children}</AppShell>;
}
