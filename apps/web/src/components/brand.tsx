// Логотип платформы рядом с названием: шапка, боковая панель и экран входа.
import { cn } from '@sde/ui';
import Image from 'next/image';
import logo from '@/assets/logo.png';

/**
 * Картинка с белым фоном (белые пояс и воротник сливаются с ним, поэтому фон не вырезан): `mix-blend-multiply`
 * делает белое невидимым на любом светлом фоне, цвета формы остаются прежними. Название платформы рядом читается
 * скринридером, сама картинка декоративна (alt="").
 */
export function Brand({ className, logoClassName }: { className?: string; logoClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Image
        src={logo}
        alt=""
        unoptimized
        priority
        className={cn('h-8 w-auto mix-blend-multiply', logoClassName)}
      />
      <span>SAMBO Digital</span>
    </span>
  );
}
