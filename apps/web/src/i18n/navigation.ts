import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Навигация с учётом локали: ссылки и переходы сохраняют /ru или /en. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
