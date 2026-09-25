'use client';
// Выбор файла кнопкой: доступная подпись, ограничения типа, состояние загрузки.
import { Spinner } from '@sde/ui';
import { useId } from 'react';

export function FilePicker({
  label,
  accept,
  busy,
  onFile,
}: {
  label: string;
  accept: string;
  busy?: boolean;
  onFile: (file: File) => void;
}) {
  const id = useId();
  return (
    <>
      <label
        htmlFor={id}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-600"
      >
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
