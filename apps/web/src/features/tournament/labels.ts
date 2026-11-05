// Даты публичной страницы турнира (правки 05.11.2026): форматирует сервер, а клиентские компоненты показывают
// готовые строки — у Node и браузера разные данные ICU (пробелы, «в»), и форматирование в браузере ломало бы гидратацию.
import type { PublicCompetition } from '@sde/contracts';

export interface TournamentLabels {
  /** «28–29 ноября 2026 г.» */
  dates: string;
  registrationFrom: string;
  registrationTo: string;
  weighIn: { name: string; from: string; to: string }[];
}

function instant(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function tournamentLabels(c: PublicCompetition, locale: string): TournamentLabels {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const s = new Date(`${c.startDate}T00:00:00Z`);
  return {
    dates: c.startDate === c.endDate ? fmt.format(s) : fmt.formatRange(s, new Date(`${c.endDate}T00:00:00Z`)),
    registrationFrom: instant(c.registrationStartsAt, c.timezone, locale),
    registrationTo: instant(c.registrationEndsAt, c.timezone, locale),
    weighIn: c.weighInWindows.map((w) => ({
      name: w.name,
      from: instant(w.startsAt, c.timezone, locale),
      to: instant(w.endsAt, c.timezone, locale),
    })),
  };
}
