// Жесты судьи для табло и планшета (правки 04.11.2026): удержание — 🫳, болевой приём — 🤜, оценка активности — ✊.
// Эмодзи — из системного шрифта; для чтеца — скрыты (рядом всегда есть подпись).
import { cn } from '@sde/ui';

export const REFEREE_GESTURES = { hold: '🫳', submission: '🤜', activity: '✊' } as const;

export function RefereeGesture({
  kind,
  className,
}: {
  kind: keyof typeof REFEREE_GESTURES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 leading-none [font-family:"Apple_Color_Emoji","Segoe_UI_Emoji","Noto_Color_Emoji",sans-serif]',
        className,
      )}
    >
      {REFEREE_GESTURES[kind]}
    </span>
  );
}
