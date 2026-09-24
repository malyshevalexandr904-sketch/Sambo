// Базовые компоненты интерфейса. Требования раздела 40 ТЗ: цели касания ≥ 44 px, видимый фокус,
// статус — не только цветом (иконка/текст задаёт вызывающий код).
import { clsx, type ClassValue } from 'clsx';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed',
        focus,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});

const control =
  'block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 aria-[invalid=true]:border-red-600';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, focus, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, focus, 'min-h-24', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, focus, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-sm font-medium text-slate-800', className)} {...props} />;
}

export interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Поле формы: подпись, подсказка и ошибка связаны с элементом через id и aria-describedby. */
export function Field({ id, label, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('mb-4 text-lg font-semibold text-slate-900', className)} {...props} />;
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800 ring-slate-300',
  success: 'bg-green-50 text-green-800 ring-green-300',
  warning: 'bg-amber-50 text-amber-900 ring-amber-300',
  danger: 'bg-red-50 text-red-800 ring-red-300',
  info: 'bg-blue-50 text-blue-800 ring-blue-300',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'border-blue-300 bg-blue-50 text-blue-900',
  success: 'border-green-300 bg-green-50 text-green-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  danger: 'border-red-300 bg-red-50 text-red-900',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-sm', ALERT_TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" className="opacity-75" />
    </svg>
  );
}

/** Таблица с горизонтальной прокруткой внутри контейнера: страница на 360 px не прокручивается вбок. */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className={cn('w-full min-w-[640px] border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-slate-100 px-3 py-2 align-top text-slate-800', className)}
      {...props}
    />
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children ? <div className="mt-2 text-sm text-slate-600">{children}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
