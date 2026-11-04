// Рейтинг Эло рядом с фамилией (правки 04.11.2026): значок вместо слова «Эло» — растущий график; подпись для
// экранного диктора и всплывающая — «Рейтинг Эло».
import { cn } from '@sde/ui';

export function EloIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-[1em] w-[1em] shrink-0', className)}
    >
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function EloBadge({
  rating,
  label,
  className,
}: {
  rating: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      className={cn('inline-flex shrink-0 items-center gap-[0.35em] tabular-nums', className)}
    >
      <EloIcon />
      <span className="sr-only">{label}: </span>
      {rating}
    </span>
  );
}
