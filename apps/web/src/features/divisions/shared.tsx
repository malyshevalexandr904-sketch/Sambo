// Подпись границ дивизиона: «10–12 лет», «до 9 лет», «от 18 лет», «любой возраст».
type T = (key: string, values?: Record<string, number>) => string;

export function ageRange(t: T, d: { minAge: number | null; maxAge: number | null }): string {
  if (d.minAge !== null && d.maxAge !== null) return t('range', { from: d.minAge, to: d.maxAge });
  if (d.maxAge !== null) return t('upTo', { to: d.maxAge });
  if (d.minAge !== null) return t('from', { from: d.minAge });
  return t('anyAge');
}
