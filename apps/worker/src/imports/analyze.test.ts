import { describe, expect, it } from 'vitest';
import { analyzeRows, type ImportLookups } from './analyze';

const lookups = (over: Partial<ImportLookups> = {}): ImportLookups => ({
  rankCodes: new Set(['YOUTH_1', 'SPORT_3']),
  coachByEmail: (email) =>
    Promise.resolve(email === 'coach@club.local' ? { id: 'c1', name: 'Тренеров С.' } : null),
  duplicates: (p) =>
    Promise.resolve(
      p.lastName === 'Дублев'
        ? [
            {
              athleteId: 'a1',
              publicName: 'Дублев Д.',
              birthYear: 2013,
              clubShortName: 'Клуб',
              regionName: null,
              similarity: 1,
            },
          ]
        : [],
    ),
  ...over,
});

describe('import preview', () => {
  it('reports field errors, unknown ranks and coaches, duplicates in the system and in the file', async () => {
    const report = await analyzeRows(
      [
        {
          row: 2,
          values: {
            lastName: 'Иванов',
            firstName: 'Пётр',
            birthDate: '2013-05-17',
            gender: 'M',
            coachEmail: 'coach@club.local',
          },
        },
        {
          row: 3,
          values: {
            lastName: 'Петров',
            firstName: 'Иван',
            birthDate: '2013-05-17',
            gender: 'M',
            sportRankCode: 'KMS',
            rankAssignedAt: '2025-01-01',
          },
        },
        {
          row: 4,
          values: {
            lastName: 'Сидоров',
            firstName: 'Илья',
            birthDate: '2013-05-17',
            gender: 'M',
            coachEmail: 'nobody@club.local',
          },
        },
        {
          row: 5,
          values: { lastName: 'Дублев', firstName: 'Дмитрий', birthDate: '2013-01-01', gender: 'M' },
        },
        { row: 6, values: { lastName: 'иванов', firstName: 'Петр', birthDate: '17.05.2013', gender: 'м' } },
        { row: 7, values: { lastName: '', firstName: 'Без', birthDate: 'вчера', gender: 'M' } },
      ],
      lookups(),
    );
    expect(report).toMatchObject({ totalRows: 6, validRows: 2, errorRows: 4, duplicateRows: 1 });
    const byRow = new Map(report.rows.map((r) => [r.row, r]));
    expect(byRow.get(2)?.coach).toEqual({ id: 'c1', name: 'Тренеров С.' });
    expect(byRow.get(3)?.errors).toEqual([{ path: 'sportRankCode', code: 'invalid_code' }]);
    expect(byRow.get(4)?.errors).toEqual([{ path: 'coachEmail', code: 'coach_not_found' }]);
    // Строка с ошибкой узнаваема по тому, как она записана в файле.
    expect(byRow.get(4)?.source).toEqual({ lastName: 'Сидоров', firstName: 'Илья', birthDate: '2013-05-17' });
    expect(byRow.get(7)?.source).toEqual({ lastName: '', firstName: 'Без', birthDate: 'вчера' });
    expect(byRow.get(5)?.duplicates.map((d) => d.athleteId)).toEqual(['a1']);
    expect(byRow.get(6)?.errors).toEqual([{ path: 'lastName', code: 'duplicate_in_file' }]);
    expect(
      byRow
        .get(7)
        ?.errors.map((e) => e.path)
        .sort(),
    ).toEqual(['birthDate', 'lastName']);
  });
});
