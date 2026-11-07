// Название платформы с логотипом (правки 07.11.2026, п. 3, 9): эмблема-узел в углу шапки и надпись «Цифровое самбо»
// в фирменном начертании — «Цифровое» тонким шрифтом, «самбо» — жирным с красно-синим градиентом цветов самбо.
// Украшение сдержанное: без анимации, читается и в светлой, и в тёмной теме (.brand-word в globals.css).
import { cn } from '@sde/ui';

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/media/logo-knot-96.webp"
      alt=""
      aria-hidden="true"
      width={161}
      height={96}
      className={cn('h-8 w-auto shrink-0', className)}
    />
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('brand-word inline-flex items-baseline gap-[0.28em] leading-none', className)}>
      <span className="brand-word-light">Цифровое</span>
      <span className="brand-word-strong">самбо</span>
    </span>
  );
}

export function Brand({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {mark ? <BrandMark /> : null}
      <BrandWordmark />
    </span>
  );
}
