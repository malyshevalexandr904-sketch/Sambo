// Название платформы: шапка, боковая панель и экран входа. Логотипа пока нет — новый будет добавлен позже.
import { cn } from '@sde/ui';

export function Brand({ className }: { className?: string }) {
  return <span className={cn('inline-flex items-center gap-2', className)}>Цифровое самбо</span>;
}
