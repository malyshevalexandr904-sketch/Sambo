// Форматирование дат по локали. Сервер отдаёт моменты в UTC (ADR-13), показываем во времени пользователя.
export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}

const BROWSERS: [RegExp, string][] = [
  [/YaBrowser\/(\d+)/, 'Yandex Browser'],
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/(?:OPR|Opera)\/(\d+)/, 'Opera'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/**
 * Короткое название устройства сеанса: «Chrome 141 · Linux». Порядок проверок важен: Edge, Opera
 * и Yandex Browser содержат «Chrome», а Chrome — «Safari». Неизвестная строка возвращается как есть.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—';
  const browser = BROWSERS.map(([re, name]) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  }).find(Boolean);
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (!browser && !system) return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
  return [browser, system].filter(Boolean).join(' · ');
}
