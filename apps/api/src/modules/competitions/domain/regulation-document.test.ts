import { describe, expect, it } from 'vitest';
import {
  birthYears,
  buildRegulation,
  formatDateRangeRu,
  formatWindowRu,
  kg,
  participantsNoun,
  plainParagraphs,
  quoted,
  type RegulationFacts,
  STANDARD_DOCUMENTS,
  weightsLine,
} from './regulation-document';

const facts = (over: Partial<RegulationFacts> = {}): RegulationFacts => ({
  draft: false,
  name: 'Кубок клуба',
  startDate: '2026-12-12',
  endDate: '2026-12-12',
  timezone: 'Europe/Moscow',
  place: { city: 'Москва', venue: 'СШ № 4', address: 'ул. Некрасовская, д. 8' },
  organizer: {
    name: 'Клуб «Самбист»',
    city: 'Москва',
    address: null,
    email: 'club@example.ru',
    phone: null,
    website: null,
  },
  responsible: { name: 'Иванов Иван', phone: '+79260000000', email: null },
  chiefReferee: 'Петров Пётр Петрович',
  chiefSecretary: null,
  matCount: 2,
  genderMode: 'SEPARATE',
  agePolicy: 'BY_BIRTH_YEAR',
  ageGroups: [
    {
      ageFrom: 11,
      ageTo: 12,
      birthYearFrom: null,
      birthYearTo: null,
      divisions: [
        {
          gender: 'MALE',
          weights: [
            { kind: 'UP_TO', grams: 34000 },
            { kind: 'ABOVE', grams: 65000 },
            { kind: 'UP_TO', grams: 31000 },
          ],
        },
        { gender: 'FEMALE', weights: [{ kind: 'UP_TO', grams: 26500 }] },
      ],
    },
  ],
  registration: { startsAt: '2026-11-20T07:00:00Z', endsAt: '2026-12-08T20:59:00Z' },
  weighIns: [
    {
      name: '2014–2015 г. р.',
      startsAt: '2026-12-11T11:00:00Z',
      endsAt: '2026-12-11T12:00:00Z',
      official: true,
    },
  ],
  extraDocuments: [],
  extraConditionsMd: null,
  weighInFailureOutcome: 'WITHDRAW',
  pageUrl: 'https://digitalsambo.ru/ru/tournaments/kubok',
  platformUrl: 'https://digitalsambo.ru',
  generatedAt: new Date('2026-11-05T10:00:00Z'),
  ...over,
});

const allText = (f: RegulationFacts): string =>
  buildRegulation(f)
    .sections.flatMap((s) => [
      s.title,
      ...s.blocks.flatMap((b) =>
        b.kind === 'bullets' ? b.items : b.kind === 'table' ? b.rows.flat() : [b.text],
      ),
    ])
    .join('\n');

describe('форматирование положения', () => {
  it('даты по-русски: день, диапазон в месяце, через месяц и год', () => {
    expect(formatDateRangeRu('2026-12-12', '2026-12-12')).toBe('12 декабря 2026 года');
    expect(formatDateRangeRu('2026-12-12', '2026-12-13')).toBe('12–13 декабря 2026 года');
    expect(formatDateRangeRu('2026-11-30', '2026-12-01')).toBe('30 ноября – 1 декабря 2026 года');
    expect(formatDateRangeRu('2026-12-31', '2027-01-01')).toBe('31 декабря 2026 года – 1 января 2027 года');
  });

  it('время взвешивания — в часовом поясе турнира', () => {
    expect(formatWindowRu('2026-12-11T11:00:00Z', '2026-12-11T12:00:00Z', 'Europe/Moscow')).toBe(
      '11 декабря 2026 г., 14:00–15:00',
    );
  });

  it('веса: по возрастанию, «свыше» с плюсом, дробные через запятую', () => {
    expect(kg(26500)).toBe('26,5');
    expect(
      weightsLine([
        { kind: 'ABOVE', grams: 65000 },
        { kind: 'UP_TO', grams: 65000 },
        { kind: 'UP_TO', grams: 31000 },
      ]),
    ).toBe('31, 65, +65');
  });

  it('участники: мальчики до 13 лет, юноши до 17, совместно', () => {
    expect(participantsNoun('MALE', 12, 11)).toBe('Мальчики');
    expect(participantsNoun('FEMALE', 16, 15)).toBe('Девушки');
    expect(participantsNoun(null, 10, 9)).toBe('Мальчики и девочки (совместно)');
  });

  it('годы рождения по правилу «по году рождения»', () => {
    const g = { ageFrom: 11, ageTo: 12, birthYearFrom: null, birthYearTo: null, divisions: [] };
    expect(birthYears(g, 'BY_BIRTH_YEAR', 2026)).toBe('2014–2015 г. р.');
    expect(birthYears(g, 'EXACT_ON_DATE', 2026)).toBeNull();
    expect(birthYears({ ...g, birthYearFrom: 2012, birthYearTo: 2013 }, 'BIRTH_YEAR_RANGE', 2026)).toBe(
      '2012–2013 г. р.',
    );
  });

  it('Markdown требований — простые абзацы без разметки', () => {
    expect(plainParagraphs('# Важно\n\n- **один** тренер\n\nСм. [сайт](https://x.ru)')).toEqual([
      'Важно',
      'один тренер',
      'См. сайт (https://x.ru)',
    ]);
  });

  it('кавычки вокруг названия — только если своих нет', () => {
    expect(quoted('Кубок клуба')).toBe('«Кубок клуба»');
    expect(quoted('Турнир «Надежда»')).toBe('Турнир «Надежда»');
  });
});

describe('buildRegulation', () => {
  it('разделы как в положениях официальных соревнований, пункты пронумерованы', () => {
    const d = buildRegulation(facts());
    expect(d.sections.map((s) => s.title)).toEqual([
      'Общие положения',
      'Организаторы соревнования',
      'Место и сроки проведения',
      'Обеспечение безопасности участников и зрителей',
      'Страхование участников',
      'Антидопинговое обеспечение',
      'Требования к участникам и условия их допуска',
      'Заявки на участие',
      'Система проведения и условия подведения итогов',
      'Награждение',
      'Условия финансирования',
      'Персональные данные',
      'Контакты',
    ]);
    const first = d.sections[0]?.blocks[0];
    expect(first).toMatchObject({ kind: 'clause', number: '1.1.' });
    expect(d.approvals.map((a) => a.title)).toEqual(['СОГЛАСОВАНО', 'УТВЕРЖДАЮ']);
    expect(d.approvals[1].lines).toContain('Клуб «Самбист»');
    expect(d.closing).toContain('официальным вызовом');
    expect(d.dateLine).toBe('12 декабря 2026 года');
    expect(d.cityYear).toBe('Москва · 2026');
  });

  it('подставляет сведения турнира: место, судьи, ковры, категории, сроки заявок, взвешивание', () => {
    const text = allText(facts());
    expect(text).toContain('Соревнование «Кубок клуба» (далее — Соревнование)');
    expect(text).toContain('Место проведения: г. Москва, СШ № 4, ул. Некрасовская, д. 8.');
    expect(text).toContain('Петров Пётр Петрович');
    expect(text).toContain('Иванов Иван, тел. +79260000000');
    expect(text).toContain('на 2 коврах');
    expect(text).toContain('31, 34, +65 кг');
    expect(text).toContain('26,5 кг');
    expect(text).toContain('2014–2015 г. р.');
    expect(text).toContain('с 20 ноября 2026 г., 10:00 по 8 декабря 2026 г., 23:59');
    expect(text).toContain('11 декабря 2026 г., 14:00–15:00');
    expect(text).toContain('выступают раздельно');
    expect(text).toContain('к соревнованию не допускается');
  });

  it('без сведений — честные формулировки «устанавливается платформой»', () => {
    const text = allText(
      facts({
        registration: null,
        weighIns: [],
        ageGroups: [],
        chiefReferee: null,
        place: { city: null, venue: null, address: null },
        matCount: null,
        genderMode: null,
      }),
    );
    expect(text).toContain('Место проведения уточняется Организатором');
    expect(text).toContain('Сроки приёма заявок устанавливаются Платформой');
    expect(text).toContain('Возрастные группы и весовые категории устанавливаются Платформой');
    expect(text).toContain('назначается Организатором по согласованию с Платформой');
    expect(text).not.toContain('коврах');
  });

  it('стандартный список документов совпадает с «Моими документами», дополнительные — в конце', () => {
    const d = buildRegulation(facts({ extraDocuments: ['Справка о вакцинации'] }));
    const bullets = d.sections[6]?.blocks.find((b) => b.kind === 'bullets');
    expect(bullets?.kind === 'bullets' && bullets.items.length).toBe(STANDARD_DOCUMENTS.length + 1);
    expect(bullets?.kind === 'bullets' && bullets.items.at(-1)).toBe('справка о вакцинации.');
  });

  it('дополнительные условия администратора — отдельный раздел перед контактами', () => {
    const d = buildRegulation(facts({ extraConditionsMd: 'Сменная обувь **обязательна**.' }));
    const titles = d.sections.map((s) => s.title);
    expect(titles.at(-2)).toBe('Дополнительные условия');
    expect(d.sections.at(-2)?.blocks[0]).toMatchObject({ text: 'Сменная обувь обязательна.' });
  });
});
