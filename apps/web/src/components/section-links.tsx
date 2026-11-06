'use client';
// Плитки разделов роли во вкладке (правки 05.11.2026, п. 4): вместо блока «Работа» в личном кабинете.
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useMe, useMyAthletes } from '@/lib/queries';
import { type SectionHost, sectionLinks } from '@/lib/sections';
import { Icon, type IconName } from './icons';

const ICON: Record<string, IconName> = {
  competitionRequests: 'flag',
  applications: 'clipboard',
  referee: 'whistle',
  recruitment: 'megaphone',
  referees: 'users',
  review: 'check',
  documents: 'file',
  children: 'heart',
  athletes: 'users',
  categories: 'scale',
  rulesets: 'book',
};

export function SectionLinks({ host, className }: { host: SectionHost; className?: string }) {
  const t = useTranslations('sections');
  const { data: me } = useMe();
  const mine = useMyAthletes(!!me?.personId);
  if (!me) return null;
  const links = sectionLinks(me, mine.data).filter((l) => l.host === host);
  if (links.length === 0) return null;
  return (
    <nav aria-label={t(`hosts.${host}`)} className={cn('mb-6', className)}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {links.map((l, i) => (
          <li key={l.href} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <Link
              href={l.href}
              className="group flex h-full min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 transition group-hover:bg-blue-700 group-hover:text-white">
                <Icon name={ICON[l.key] ?? 'arrow'} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-slate-900">{t(`links.${l.key}.title`)}</span>
                <span className="block text-xs text-slate-600">{t(`links.${l.key}.hint`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
