// Unit: чтение CSV и XLSX для импорта спортсменов.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeText, excelSerialToIso, ImportFileProblem, parseCsv, readImportFile } from './parse';

const cp1251 = (text: string): Uint8Array => {
  const table = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
  return Uint8Array.from(
    [...text].map((ch) => {
      if (ch === 'ё') return 0xb8;
      if (ch === 'Ё') return 0xa8;
      const i = table.indexOf(ch);
      return i >= 0 ? 0xc0 + i : ch.charCodeAt(0);
    }),
  );
};

function xlsx(sheetXml: string, shared: string[] = [], workbookPr = ''): Uint8Array {
  const sst = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared
    .map((s) => `<si><t>${s}</t></si>`)
    .join('')}</sst>`;
  return zipSync({
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${workbookPr}<sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(sst),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${sheetXml}</sheetData></worksheet>`,
    ),
  });
}

describe('CSV', () => {
  it('detects the delimiter and handles quotes and line breaks inside quotes', () => {
    const rows = parseCsv('a;b;c\r\n"x;1";"he said ""hi""";"multi\nline"\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b', 'c'],
      ['x;1', 'he said "hi"', 'multi\nline'],
    ]);
    expect(parseCsv('a,b\n1,2').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads UTF-8 with BOM and Windows-1251 from Excel', () => {
    expect(decodeText(strToU8('﻿Фамилия'))).toBe('Фамилия');
    expect(decodeText(cp1251('Фамилия;Ёлкин'))).toBe('Фамилия;Ёлкин');
  });

  it('maps Russian headers to template columns and skips blank lines', () => {
    const csv =
      'Фамилия;Имя;Дата рождения;Пол;Рост\nИванов;Пётр;17.05.2013;м;150\n;;;;\nПетрова;Анна;2012-01-02;Ж;\n';
    expect(readImportFile(strToU8(csv), 'text/csv')).toEqual([
      { row: 2, values: { lastName: 'Иванов', firstName: 'Пётр', birthDate: '17.05.2013', gender: 'м' } },
      { row: 4, values: { lastName: 'Петрова', firstName: 'Анна', birthDate: '2012-01-02', gender: 'Ж' } },
    ]);
  });

  it('reports missing columns, empty files and too many rows', () => {
    const problem = (fn: () => unknown): ImportFileProblem => {
      try {
        fn();
      } catch (e) {
        if (e instanceof ImportFileProblem) return e;
      }
      throw new Error('no problem');
    };
    expect(problem(() => readImportFile(strToU8('Фамилия;Имя\nА;Б'), 'text/csv')).details).toEqual({
      missing: ['birthDate', 'gender'],
    });
    expect(problem(() => readImportFile(strToU8(''), 'text/csv')).code).toBe('EMPTY_FILE');
    expect(
      problem(() => readImportFile(strToU8('lastName;firstName;birthDate;gender\n'), 'text/csv')).code,
    ).toBe('EMPTY_FILE');
    const many = 'lastName;firstName;birthDate;gender\n' + 'А;Б;2012-01-01;M\n'.repeat(1001);
    expect(problem(() => readImportFile(strToU8(many), 'text/csv')).code).toBe('TOO_MANY_ROWS');
  });
});

describe('XLSX', () => {
  it('reads shared and inline strings, skips empty cells and converts Excel dates', () => {
    const sheet =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="F1" t="s"><v>4</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Иванов &amp; сын</t></is></c><c r="B3" t="s"><v>5</v></c><c r="C3" s="1"><v>41411</v></c><c r="D3" t="s"><v>6</v></c><c r="F3"><v>123</v></c></row>';
    const file = xlsx(sheet, ['Фамилия', 'Имя', 'Дата рождения', 'Пол', 'Номер приказа', 'Пётр', 'М']);
    expect(readImportFile(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toEqual(
      [
        {
          row: 3,
          values: {
            lastName: 'Иванов & сын',
            firstName: 'Пётр',
            birthDate: '2013-05-17',
            gender: 'М',
            rankOrderRef: '123',
          },
        },
      ],
    );
  });

  it('supports the 1904 date system and rejects files that are not workbooks', () => {
    expect(excelSerialToIso(41411)).toBe('2013-05-17');
    expect(excelSerialToIso(39949, true)).toBe('2013-05-17');
    expect(excelSerialToIso(-1)).toBeNull();
    expect(() =>
      readImportFile(
        strToU8('not a zip'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toThrow(ImportFileProblem);
  });
});
