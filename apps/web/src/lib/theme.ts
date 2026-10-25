// Тема интерфейса: светлая по умолчанию, тёмная — по выбору пользователя. Выбор хранится в cookie этого браузера,
// поэтому сервер сразу отдаёт страницу в нужных цветах (layout ставит <html data-theme>).
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'sde-theme';

export function themeOf(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

/** Применить тему на странице и запомнить её на год. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
