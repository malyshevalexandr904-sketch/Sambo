// Проверка сигнатуры файла (magic bytes) против заявленного типа (ARCHITECTURE.md, 18; SECURITY.md, 3.3).

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const CHECKS: Record<string, (buf: Buffer) => boolean> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  'application/pdf': (b) => startsWith(b, ascii('%PDF-')),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  // CSV: текст UTF-8 без нулевых байтов и без HTML/скриптов в начале.
  'text/csv': (b) => {
    if (b.includes(0)) return false;
    const head = b.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<')) return false;
    return !b.toString('utf8').includes('�');
  },
};

export function signatureMatches(mimeType: string, content: Buffer): boolean {
  const check = CHECKS[mimeType];
  return check ? check(content) : false;
}

export function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    case 'text/csv':
      return 'csv';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    default:
      return 'bin';
  }
}

/** Имя файла только для отображения: без путей, управляющих символов и лишней длины. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 200);
}
