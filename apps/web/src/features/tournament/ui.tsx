'use client';
// Общие части разделов публичной страницы турнира: карточка раздела и заглушка «скоро».
import { cn } from '@sde/ui';
import type { ReactNode } from 'react';

export const Box = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn('rounded-xl border border-slate-200 bg-white p-4 sm:p-6', className)}>
    {children}
  </section>
);

/** Заглушка раздела «скоро»: значок, заголовок и пояснение. */
export function Placeholder({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <Box className="text-center">
      <p aria-hidden="true" className="stage-float text-5xl">
        {icon}
      </p>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{text}</p>
    </Box>
  );
}
