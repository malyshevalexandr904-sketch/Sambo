import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-slate-900">
          SAMBO Digital
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
