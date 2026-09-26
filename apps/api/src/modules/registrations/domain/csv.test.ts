import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv export', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('Иванов; Пётр')).toBe('"Иванов; Пётр"');
    expect(csvCell('СШ "Самбо-70"')).toBe('"СШ ""Самбо-70"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(38000)).toBe('38000');
  });

  it('neutralises cells that Excel would treat as formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+7 999')).toBe("'+7 999");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('starts with a BOM and uses CRLF', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFa;b\r\n1;2\r\n');
  });
});
