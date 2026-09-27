// Slug турнира для публичной страницы /tournaments/{slug}: транслитерация названия и год начала.

/** Добавляет год, если его нет в названии: «Открытое первенство клуба» → «…-2026». */
export function competitionSlugBase(nameSlug: string, startDate: string): string {
  const year = startDate.slice(0, 4);
  const base = nameSlug.includes(year) ? nameSlug : `${nameSlug}-${year}`;
  return base.slice(0, 74).replace(/-+$/g, '');
}
