// CSV для Excel (API.md, 5.3): UTF-8 с BOM, разделитель «;» (русская локаль Excel), CRLF.
// Ячейки, которые Excel принял бы за формулу, экранируются апострофом (CSV injection, OWASP).

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
