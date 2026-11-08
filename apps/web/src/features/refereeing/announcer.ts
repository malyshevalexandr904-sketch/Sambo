// Голосовые объявления руководителя ковра встроенным голосом компьютера (Web Speech API): после «Вызвать пару» —
// «Ковёр 2. На ковёр вызываются: Иванов, Петров. Готовятся: Сидоров и Кузнецов.», после подтверждения результата —
// «Победу одержал Иванов.». Первым называют красный угол, вторым синий, поэтому углы вслух не называются.
// Звук идёт с того устройства, где нажата кнопка (ноутбук руководителя ковра с колонкой). Настройки — на устройстве.

export interface AnnouncerSettings {
  enabled: boolean;
  /** Выбранный голос (SpeechSynthesisVoice.voiceURI); null — лучший русский из найденных. */
  voiceURI: string | null;
  rate: number;
}

export const DEFAULT_ANNOUNCER: AnnouncerSettings = { enabled: true, voiceURI: null, rate: 0.9 };
const KEY = 'sde.announcer';

type Pair = { red: { publicName: string | null }; blue: { publicName: string | null } };

/** «Иванов И.» → «Иванов»: инициалы вслух не читаем. */
export function speakableName(publicName: string | null | undefined): string | null {
  const s = (publicName ?? '').replace(/(\s+[A-Za-zА-Яа-яЁё]\.)+\s*$/u, '').trim();
  return s && s !== '—' ? s : null;
}

function names(p: Pair | null | undefined): [string, string] | null {
  if (!p) return null;
  const r = speakableName(p.red.publicName);
  const b = speakableName(p.blue.publicName);
  return r && b ? [r, b] : null;
}

/** Вызов на ковёр и, если следующая пара известна, кто готовится. Пусто — объявлять нечего. */
export function callPhrase(matNumber: number, match: Pair, next?: Pair | null): string[] {
  const now = names(match);
  if (!now) return [];
  const parts = [`Ковёр ${matNumber}.`, `На ковёр вызываются: ${now[0]}, ${now[1]}.`];
  const n = names(next);
  if (n) parts.push(`Готовятся: ${n[0]} и ${n[1]}.`);
  return parts;
}

export function winnerPhrase(
  match: Pair & { result: { winnerSide: 'RED' | 'BLUE' | null } | null },
): string[] {
  const side = match.result?.winnerSide;
  if (!side) return [];
  const name = speakableName(side === 'RED' ? match.red.publicName : match.blue.publicName);
  return name ? [`Победу одержал ${name}.`] : [];
}

export function loadAnnouncer(): AnnouncerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_ANNOUNCER, ...(JSON.parse(raw) as Partial<AnnouncerSettings>) };
  } catch {
    // Хранилище недоступно (приватный режим): настройки по умолчанию.
  }
  return DEFAULT_ANNOUNCER;
}

export function saveAnnouncer(s: AnnouncerSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Не сохранилось — действует до перезагрузки страницы.
  }
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Русские голоса, лучшие наверху (Google, Milena/Yuri на Mac, Svetlana/Dmitry/Irina/Pavel на Windows). */
export function russianVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  const rank = (v: SpeechSynthesisVoice): number =>
    /google|milena|yuri|svetlana|dmitry|irina|pavel/i.test(v.name) ? 0 : 1;
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^ru/i.test(v.lang))
    .sort((a, b) => rank(a) - rank(b));
}

/** Произносит фразы по очереди (отдельными репликами — естественные паузы, Chrome не обрывает длинный текст). */
export function speak(parts: string[], settings: AnnouncerSettings = loadAnnouncer()): void {
  if (!settings.enabled || parts.length === 0 || !speechSupported()) return;
  const synth = window.speechSynthesis;
  const voices = russianVoices();
  const voice = voices.find((v) => v.voiceURI === settings.voiceURI) ?? voices[0];
  synth.cancel();
  for (const text of parts) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    if (voice) u.voice = voice;
    u.rate = settings.rate;
    synth.speak(u);
  }
}
