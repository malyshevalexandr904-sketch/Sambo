'use client';
import { liveHoldMs, type LiveMatchDto, liveSubmissionMs, type Side } from '@sde/contracts';
import { cn } from '@sde/ui';
import { useTranslations } from 'next-intl';
import { RefereeGesture } from '@/components/referee-gesture';

/**
 * Жесты судьи на половине спортсмена (правки 04.11.2026): в нижнем крайнем углу, в один ряд — удержание 🫳,
 * болевой 🤜, активность ✊. Загорается жест того, кто проводит приём или получил оценку активности; у удержания и
 * болевого под жестом — секунды. Подписей нет: их заменяют жесты (для чтеца — скрытый текст).
 */
export function GestureLights({
  side,
  match,
  serverNow,
}: {
  side: Side;
  match: LiveMatchDto;
  serverNow: number;
}) {
  const t = useTranslations('scoreboard');
  const hold = match.hold?.side === side ? match.hold : null;
  const subAt = side === 'RED' ? match.submissions.red : match.submissions.blue;
  const lights: {
    kind: 'hold' | 'submission' | 'activity';
    label: string;
    on: boolean;
    seconds: number | null;
  }[] = [
    {
      kind: 'hold',
      label: t('holdLabel'),
      on: hold !== null,
      seconds: hold ? Math.floor(liveHoldMs(hold, serverNow) / 1000) : null,
    },
    {
      kind: 'submission',
      label: t('submissionLabel'),
      on: subAt !== null,
      seconds: subAt ? Math.floor(liveSubmissionMs(subAt, serverNow) / 1000) : null,
    },
    { kind: 'activity', label: t('activity'), on: match.activity === side, seconds: null },
  ];
  return (
    <ul
      className={cn(
        'absolute bottom-[4.5vh] flex gap-[1vw]',
        side === 'RED' ? 'left-[2vw]' : 'right-[2vw] flex-row-reverse',
      )}
    >
      {lights.map((l) => (
        <li
          key={l.kind}
          role={l.seconds !== null ? 'timer' : undefined}
          className={cn(
            'flex h-[min(15vh,9.5vw)] w-[min(13vh,8vw)] flex-col items-center justify-center gap-[0.8vh] overflow-hidden rounded-[1.4vh] py-[1vh] transition duration-300',
            // Загорание — вспышка и мягкое свечение, пока приём идёт (sb-light-on, globals.css).
            l.on ? 'sb-light-on bg-white' : 'bg-black/15',
          )}
        >
          <RefereeGesture
            kind={l.kind}
            className={cn(
              'transition duration-300',
              // С секундами жест чуть меньше: жест и число помещаются в плашку.
              l.on && l.seconds !== null ? 'text-[min(6vh,3.8vw)]' : 'text-[min(8vh,5vw)]',
              // Жест делает своё движение: удержание прижимает, болевой — толчок, активность — поднятый кулак.
              l.on ? `scale-100 sb-gesture-${l.kind}` : 'scale-90 opacity-20 grayscale',
            )}
          />
          {l.on && l.seconds !== null ? (
            <span className="text-[min(4.6vh,3vw)] font-black leading-none tabular-nums text-slate-950">
              {l.seconds}
            </span>
          ) : null}
          {l.on ? <span className="sr-only">{l.label}</span> : null}
        </li>
      ))}
    </ul>
  );
}
