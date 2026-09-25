// Чтение файла импорта спортсменов (API.md, 4.4; G-14): CSV (UTF-8 или Windows-1251, разделители ; , Tab)
// и XLSX (первый лист). Без макросов и формул: берутся только значения ячеек.
import {
  IMPORT_MAX_ROWS,
  IMPORT_REQUIRED_COLUMNS,
  type ImportColumn,
  importColumnFor,
  type ImportFileError,
} from '@sde/contracts';
import { unzipSync } from 'fflate';

export class ImportFileProblem extends Error {
  constructor(
    readonly code: ImportFileError,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface RawRow {
  /** Номер строки в файле: заголовок — строка 1. */
  row: number;
  values: Partial<Record<ImportColumn, string>>;
}

type Table = { row: number; cells: string[] }[];

/** Excel сохраняет «CSV» в Windows-1251: если текст не UTF-8, читаем как cp1251. */
export function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string): number => firstLine.split(d).length - 1;
  return [';', ',', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ';');
}

/** RFC 4180: кавычки, удвоенные кавычки, переносы строк внутри кавычек. */
export function parseCsv(text: string): Table {
  const delimiter = detectDelimiter(text);
  const records: Table = [];
  let field = '';
  let cells: string[] = [];
  let quoted = false;
  let row = 1;
  const endRecord = (): void => {
    cells.push(field);
    records.push({ row, cells });
    row += 1;
    cells = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else field += ch;
  }
  if (field !== '' || cells.length > 0) endRecord();
  return records;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? '';
  });
}

/** Текст элемента со строкой: все <t>, кроме фонетических подсказок <rPh>. */
function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((m) => decodeXml(m[1] ?? ''))
    .join('');
}

function attrs(s: string): Record<string, string> {
  return Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

const MAX_XML_BYTES = 50 * 1024 * 1024;
const utf8 = (b: Uint8Array | undefined): string => (b ? new TextDecoder('utf-8').decode(b) : '');

export interface XlsxCell {
  text: string;
  /** Числовое значение ячейки (для дат Excel хранит порядковый номер дня). */
  number: number | null;
}

/** Первый лист книги XLSX. Даты остаются числами: их переводит `excelSerialToIso` там, где ждём дату. */
export function parseXlsx(buf: Uint8Array): {
  rows: { row: number; cells: XlsxCell[] }[];
  date1904: boolean;
} {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) =>
        f.originalSize <= MAX_XML_BYTES &&
        (f.name === 'xl/workbook.xml' ||
          f.name === 'xl/_rels/workbook.xml.rels' ||
          f.name === 'xl/sharedStrings.xml' ||
          f.name.startsWith('xl/worksheets/sheet')),
    });
  } catch {
    throw new ImportFileProblem('FILE_UNREADABLE');
  }
  const workbook = utf8(files['xl/workbook.xml']);
  if (!workbook) throw new ImportFileProblem('FILE_UNREADABLE');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  const relId = firstSheet ? attrs(firstSheet[1] ?? '')['r:id'] : undefined;
  const rels = utf8(files['xl/_rels/workbook.xml.rels']);
  const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((m) => attrs(m[1] ?? ''))
    .find((a) => a.Id === relId);
  const target = rel?.Target ? rel.Target.replace(/^\/?(xl\/)?/, 'xl/') : 'xl/worksheets/sheet1.xml';
  const sheet = utf8(files[target]);
  if (!sheet) throw new ImportFileProblem('FILE_UNREADABLE');
  const shared = [...utf8(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    textRuns(m[1] ?? ''),
  );

  const rows: { row: number; cells: XlsxCell[] }[] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attrs(rowMatch[1] ?? '').r ?? rows.length + 1);
    const cells: XlsxCell[] = [];
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1] ?? '');
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell: XlsxCell;
      if (a.t === 's') cell = { text: shared[Number(v)] ?? '', number: null };
      else if (a.t === 'inlineStr') cell = { text: textRuns(body), number: null };
      else if (a.t === 'str' || a.t === 'e') cell = { text: decodeXml(v ?? ''), number: null };
      else if (a.t === 'b') cell = { text: v === '1' ? 'TRUE' : 'FALSE', number: null };
      else {
        const n = v === undefined ? null : Number(v);
        cell = {
          text: v === undefined ? '' : decodeXml(v),
          number: n !== null && Number.isFinite(n) ? n : null,
        };
      }
      cells[a.r ? columnIndex(a.r) : cells.length] = cell;
    }
    rows.push({ row: rowNumber, cells: Array.from(cells, (x) => x ?? { text: '', number: null }) });
  }
  return { rows, date1904 };
}

/** Порядковый номер дня Excel → YYYY-MM-DD (система 1900 с её «29.02.1900» или 1904). */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

const DATE_COLUMNS: ReadonlySet<ImportColumn> = new Set(['birthDate', 'rankAssignedAt']);

function mapColumns(header: string[]): (ImportColumn | null)[] {
  const columns = header.map(importColumnFor);
  const missing = IMPORT_REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) throw new ImportFileProblem('MISSING_COLUMNS', { missing });
  return columns;
}

function checkSize(dataRows: number): void {
  if (dataRows === 0) throw new ImportFileProblem('EMPTY_FILE');
  if (dataRows > IMPORT_MAX_ROWS) throw new ImportFileProblem('TOO_MANY_ROWS', { max: IMPORT_MAX_ROWS });
}

const isBlank = (cells: string[]): boolean => cells.every((c) => c.trim() === '');

/** Строки файла по колонкам шаблона. Пустые строки пропускаются. */
export function readImportFile(buf: Uint8Array, mimeType: string): RawRow[] {
  if (mimeType === 'text/csv') {
    const [header, ...rest] = parseCsv(decodeText(buf)).filter((r) => !isBlank(r.cells));
    if (!header) throw new ImportFileProblem('EMPTY_FILE');
    const columns = mapColumns(header.cells);
    checkSize(rest.length);
    return rest.map((r) => ({
      row: r.row,
      values: Object.fromEntries(columns.flatMap((c, i) => (c ? [[c, (r.cells[i] ?? '').trim()]] : []))),
    }));
  }
  const { rows, date1904 } = parseXlsx(buf);
  const nonEmpty = rows.filter((r) => !isBlank(r.cells.map((c) => c.text)));
  const [header, ...rest] = nonEmpty;
  if (!header) throw new ImportFileProblem('EMPTY_FILE');
  const columns = mapColumns(header.cells.map((c) => c.text));
  checkSize(rest.length);
  return rest.map((r) => ({
    row: r.row,
    values: Object.fromEntries(
      columns.flatMap((c, i) => {
        if (!c) return [];
        const cell = r.cells[i];
        if (!cell) return [[c, '']];
        if (DATE_COLUMNS.has(c) && cell.number !== null)
          return [[c, excelSerialToIso(cell.number, date1904) ?? cell.text]];
        return [[c, cell.text.trim()]];
      }),
    ),
  }));
}
