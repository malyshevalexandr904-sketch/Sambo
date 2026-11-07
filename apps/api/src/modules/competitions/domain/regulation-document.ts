// Фирменное положение турнира «Цифровое Самбо» (правки 05.11.2026, п. 8). Структура и формулировки — по образцу
// положений официальных соревнований по самбо (первенства Москвы, Московской области, России): общие положения,
// организаторы, место и сроки, безопасность, страхование, антидопинг, допуск, заявки, система проведения, награждение,
// финансирование. Сведения о турнире подставляются из заявки организатора и из турнира на платформе.
// Чистая функция: данные → блоки документа; оформление PDF — application/regulation-pdf.ts.

export type RegulationGender = 'MALE' | 'FEMALE';
export type RegulationGenderMode = 'BOYS' | 'GIRLS' | 'MIXED' | 'SEPARATE';
export type RegulationAgePolicy = 'BY_BIRTH_YEAR' | 'EXACT_ON_DATE' | 'BIRTH_YEAR_RANGE';

/** Весовая категория: «до N кг» или «свыше N кг», граница в граммах. */
export interface RegulationWeight {
  kind: 'UP_TO' | 'ABOVE';
  grams: number;
}

/** Возрастная группа с весовыми категориями по полу. Пол `null` — мальчики и девочки выступают совместно. */
export interface RegulationAgeGroup {
  ageFrom: number | null;
  ageTo: number | null;
  birthYearFrom: number | null;
  birthYearTo: number | null;
  divisions: { gender: RegulationGender | null; weights: RegulationWeight[] }[];
}

export interface RegulationContact {
  name: string;
  phone: string | null;
  email: string | null;
}

export interface RegulationFacts {
  /** Проект (заявка ещё не одобрена или турнир не опубликован): в PDF — водяной знак «ПРОЕКТ». */
  draft: boolean;
  name: string;
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  timezone: string;
  place: { city: string | null; venue: string | null; address: string | null };
  organizer: {
    name: string;
    city: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  responsible: RegulationContact | null;
  chiefReferee: string | null;
  chiefSecretary: string | null;
  matCount: number | null;
  genderMode: RegulationGenderMode | null;
  agePolicy: RegulationAgePolicy;
  ageGroups: RegulationAgeGroup[];
  /** Окно приёма заявок (ISO); `null` — сроки ещё не установлены. */
  registration: { startsAt: string; endsAt: string } | null;
  weighIns: { name: string; startsAt: string; endsAt: string; official: boolean }[];
  /** Документы, которые турнир требует сверх стандартного списка платформы (названия типов документов). */
  extraDocuments: string[];
  /** Дополнительные условия администратора (Markdown требований турнира). */
  extraConditionsMd: string | null;
  weighInFailureOutcome: 'WITHDRAW' | 'RECHECK' | 'TRANSFER' | null;
  /** Адрес страницы турнира на платформе. */
  pageUrl: string | null;
  platformUrl: string;
  generatedAt: Date;
}

export type RegulationBlock =
  | { kind: 'clause'; number: string; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; columns: string[]; widths: number[]; rows: string[][] }
  | { kind: 'note'; text: string };

export interface RegulationSection {
  number: number;
  title: string;
  blocks: RegulationBlock[];
}

export interface RegulationApproval {
  title: string;
  lines: string[];
}

export interface RegulationDocument {
  draft: boolean;
  name: string;
  /** «15 ноября 2026 года». */
  dateLine: string;
  /** «г. Москва, ул. …». */
  placeLine: string | null;
  /** Город и год внизу титульного листа: «Москва · 2026». */
  cityYear: string;
  approvals: [RegulationApproval, RegulationApproval];
  sections: RegulationSection[];
  closing: string;
  generatedLine: string;
}

// ---------- Форматирование ----------

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function parseDay(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** «15 ноября 2026 года»; диапазон — «15–16 ноября 2026 года» или «30 ноября – 1 декабря 2026 года». */
export function formatDateRangeRu(start: string, end: string): string {
  const a = parseDay(start);
  const b = parseDay(end);
  const month = (m: number) => MONTHS_GENITIVE[m - 1] ?? '';
  if (start.slice(0, 10) === end.slice(0, 10)) return `${a.d} ${month(a.m)} ${a.y} года`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${month(a.m)} ${a.y} года`;
  if (a.y === b.y) return `${a.d} ${month(a.m)} – ${b.d} ${month(b.m)} ${a.y} года`;
  return `${a.d} ${month(a.m)} ${a.y} года – ${b.d} ${month(b.m)} ${b.y} года`;
}

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  time: string;
}

function zoned(iso: string, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** «10 ноября 2026 г., 18:00» во времени турнира. */
export function formatDateTimeRu(iso: string, timeZone: string): string {
  const z = zoned(iso, timeZone);
  return `${z.d} ${MONTHS_GENITIVE[z.m - 1]} ${z.y} г., ${z.time}`;
}

/** «10 ноября 2026 г., 09:00–11:00»; через полночь — обе даты. */
export function formatWindowRu(startsAt: string, endsAt: string, timeZone: string): string {
  const a = zoned(startsAt, timeZone);
  const b = zoned(endsAt, timeZone);
  if (a.y === b.y && a.m === b.m && a.d === b.d)
    return `${a.d} ${MONTHS_GENITIVE[a.m - 1]} ${a.y} г., ${a.time}–${b.time}`;
  return `${formatDateTimeRu(startsAt, timeZone)} – ${formatDateTimeRu(endsAt, timeZone)}`;
}

/** 34000 → «34», 34500 → «34,5». */
export function kg(grams: number): string {
  const v = Math.round(grams / 100) / 10;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}

/** Весовые категории по возрастанию: «34, 37, 40, +40». */
export function weightsLine(weights: RegulationWeight[]): string {
  const sorted = [...weights].sort((x, y) => x.grams - y.grams || (x.kind === 'UP_TO' ? -1 : 1));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of sorted) {
    const label = w.kind === 'ABOVE' ? `+${kg(w.grams)}` : kg(w.grams);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(', ');
}

/** Мальчики/девочки до 13 лет включительно, юноши/девушки до 17, взрослые — мужчины/женщины. */
export function participantsNoun(
  gender: RegulationGender | null,
  ageTo: number | null,
  ageFrom: number | null,
): string {
  const kids = ageTo !== null && ageTo <= 13;
  const adults = ageFrom !== null && ageFrom >= 18;
  if (gender === 'MALE') return kids ? 'Мальчики' : adults ? 'Мужчины' : 'Юноши';
  if (gender === 'FEMALE') return kids ? 'Девочки' : adults ? 'Женщины' : 'Девушки';
  return kids
    ? 'Мальчики и девочки (совместно)'
    : adults
      ? 'Мужчины и женщины (совместно)'
      : 'Юноши и девушки (совместно)';
}

function ageLabel(g: RegulationAgeGroup): string {
  if (g.ageFrom !== null && g.ageTo !== null)
    return g.ageFrom === g.ageTo ? `${g.ageFrom} лет` : `${g.ageFrom}–${g.ageTo} лет`;
  if (g.ageFrom !== null) return `${g.ageFrom} лет и старше`;
  if (g.ageTo !== null) return `до ${g.ageTo} лет`;
  return 'без ограничения возраста';
}

/** Годы рождения группы: по правилу «по году рождения» возраст считается на 31 декабря года соревнования. */
export function birthYears(g: RegulationAgeGroup, policy: RegulationAgePolicy, year: number): string | null {
  if (g.birthYearFrom !== null || g.birthYearTo !== null) {
    if (g.birthYearFrom !== null && g.birthYearTo !== null)
      return g.birthYearFrom === g.birthYearTo
        ? `${g.birthYearFrom} г. р.`
        : `${Math.min(g.birthYearFrom, g.birthYearTo)}–${Math.max(g.birthYearFrom, g.birthYearTo)} г. р.`;
    return g.birthYearFrom !== null ? `${g.birthYearFrom} г. р. и младше` : `${g.birthYearTo} г. р. и старше`;
  }
  if (policy !== 'BY_BIRTH_YEAR') return null;
  if (g.ageFrom !== null && g.ageTo !== null) {
    const from = year - g.ageTo;
    const to = year - g.ageFrom;
    return from === to ? `${from} г. р.` : `${from}–${to} г. р.`;
  }
  return null;
}

/** Markdown требований → абзацы простого текста (без разметки). */
export function plainParagraphs(md: string): string[] {
  return md
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s?)/, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/[*_`]+/g, '')
        .trim(),
    )
    .filter((p) => p.length > 0);
}

// ---------- Документ ----------

const LAW_329 =
  'Федеральным законом от 04.12.2007 № 329-ФЗ «О физической культуре и спорте в Российской Федерации»';
const RULES_SAMBO =
  'Правилами вида спорта «самбо», утверждёнными приказом Минспорта России от 04.12.2020 № 892';
const SAFETY_353 =
  'Правилами обеспечения безопасности при проведении официальных спортивных соревнований, утверждёнными постановлением Правительства Российской Федерации от 18.04.2014 № 353';
const MEDICAL_1144 =
  'приказом Минздрава России от 23.10.2020 № 1144н «Об утверждении порядка организации оказания медицинской помощи лицам, занимающимся физической культурой и спортом…»';
const ANTIDOPING_464 =
  'Общероссийскими антидопинговыми правилами, утверждёнными приказом Минспорта России от 24.06.2021 № 464';

const GENDER_MODE_TEXT: Record<RegulationGenderMode, string> = {
  BOYS: 'В соревновании участвуют только юноши (мальчики).',
  GIRLS: 'В соревновании участвуют только девушки (девочки).',
  MIXED: 'Юноши и девушки (мальчики и девочки) выступают совместно, в общих весовых категориях.',
  SEPARATE: 'Юноши и девушки (мальчики и девочки) выступают раздельно, в своих весовых категориях.',
};

const WEIGH_IN_OUTCOME_TEXT: Record<NonNullable<RegulationFacts['weighInFailureOutcome']>, string> = {
  WITHDRAW:
    'Спортсмен, не уложившийся в границы заявленной весовой категории, к соревнованию не допускается.',
  RECHECK:
    'Спортсмен, не уложившийся в границы заявленной весовой категории, вправе пройти повторное взвешивание в пределах времени, отведённого на взвешивание; при повторном несоответствии к соревнованию не допускается.',
  TRANSFER:
    'Спортсмен, не уложившийся в границы заявленной весовой категории, по решению главной судейской коллегии может быть переведён в соответствующую весовую категорию той же возрастной группы при её наличии.',
};

/** Стандартный список документов платформы (совпадает с разделом «Мои документы» спортсмена). */
export const STANDARD_DOCUMENTS = [
  'документ, удостоверяющий личность: для лиц 14 лет и старше — паспорт гражданина Российской Федерации; для лиц младше 14 лет — свидетельство о рождении вместе со справкой из общеобразовательной организации с фотографией;',
  'договор (полис) страхования жизни и здоровья от несчастных случаев, действующий в дни соревнования (оригинал);',
  'полис обязательного медицинского страхования;',
  'зачётная классификационная книжка или приказ о присвоении спортивного разряда (звания) — при наличии;',
  'медицинский допуск к соревнованиям по самбо: медицинская справка или заключение медицинской комиссии (врачебно-физкультурного диспансера).',
];

function contactLine(c: RegulationContact): string {
  const parts = [c.name];
  if (c.phone) parts.push(`тел. ${c.phone}`);
  if (c.email) parts.push(`эл. почта ${c.email}`);
  return parts.join(', ');
}

function placeLine(f: RegulationFacts): string | null {
  const parts: string[] = [];
  const city = f.place.city?.trim();
  const address = f.place.address?.trim();
  if (city && !(address && address.toLowerCase().includes(city.toLowerCase()))) parts.push(`г. ${city}`);
  if (f.place.venue?.trim()) parts.push(f.place.venue.trim());
  if (address) parts.push(address);
  return parts.length > 0 ? parts.join(', ') : null;
}

class SectionBuilder {
  readonly sections: RegulationSection[] = [];

  section(
    title: string,
    fill: (s: { clause(text: string): void; add(block: RegulationBlock): void }) => void,
  ): void {
    const number = this.sections.length + 1;
    const blocks: RegulationBlock[] = [];
    let clauses = 0;
    fill({
      clause: (text) => blocks.push({ kind: 'clause', number: `${number}.${++clauses}.`, text }),
      add: (block) => blocks.push(block),
    });
    this.sections.push({ number, title, blocks });
  }
}

export function buildRegulation(f: RegulationFacts): RegulationDocument {
  const year = parseDay(f.startDate).y;
  const dates = formatDateRangeRu(f.startDate, f.endDate);
  const place = placeLine(f);
  const tz = f.timezone;
  const b = new SectionBuilder();

  b.section('Общие положения', (s) => {
    s.clause(
      `Соревнование ${quoted(f.name)} (далее — Соревнование) проводится в соответствии с ${LAW_329}, ${RULES_SAMBO}, ` +
        'регламентом проведения рейтинговых турниров платформы «Цифровое Самбо» и настоящим Положением.',
    );
    s.clause(
      'Соревнование проводится с целью популяризации и развития самбо среди детей и молодёжи. Задачи Соревнования:',
    );
    s.add({
      kind: 'bullets',
      items: [
        'пропаганда здорового образа жизни и привлечение детей и молодёжи к регулярным занятиям самбо;',
        'повышение спортивного мастерства и накопление соревновательного опыта: каждый участник проводит не менее двух схваток;',
        'определение рейтинга (Elo) спортсменов платформы «Цифровое Самбо» и выявление сильнейших спортсменов;',
        'укрепление дружеских связей между спортивными организациями, тренерами и спортсменами.',
      ],
    });
    s.clause(
      'Соревнование является рейтинговым: результаты всех проведённых схваток учитываются при расчёте рейтинга Elo спортсменов на платформе «Цифровое Самбо».',
    );
    s.clause(
      'В соответствии с пунктом 3 части 4 статьи 26.2 Федерального закона № 329-ФЗ запрещается оказывать противоправное влияние на результаты Соревнования, а также участвовать в азартных играх в букмекерских конторах и тотализаторах путём заключения пари на Соревнование. Предотвращение противоправного влияния на результаты Соревнования и борьба с ним осуществляются в соответствии с законодательством Российской Федерации.',
    );
  });

  b.section('Организаторы соревнования', (s) => {
    s.clause(
      `Организатор Соревнования — ${f.organizer.name} (далее — Организатор). Организатор обеспечивает место проведения, ` +
        'материально-техническое оснащение, медицинское обеспечение и судейскую бригаду в объёме, согласованном с платформой.',
    );
    s.clause(
      'Техническое обеспечение Соревнования — приём заявок, мандатная комиссия, взвешивание, жеребьёвка, табло схваток, протоколы, публикация результатов и расчёт рейтинга — осуществляет платформа «Цифровое Самбо» (далее — Платформа).',
    );
    s.clause(
      'Непосредственное проведение Соревнования возлагается на главную судейскую коллегию. Ответственность за соблюдение правил проведения Соревнования и соответствие участников требованиям настоящего Положения несёт главный судья; за медицинское обеспечение — врач Соревнования.',
    );
    const rows: string[][] = [
      ['Главный судья', f.chiefReferee ?? 'назначается Организатором по согласованию с Платформой'],
      ['Главный секретарь', f.chiefSecretary ?? 'назначается Организатором по согласованию с Платформой'],
    ];
    if (f.responsible) rows.push(['Ответственный за проведение', contactLine(f.responsible)]);
    s.add({ kind: 'table', columns: ['Должность', 'ФИО и контакты'], widths: [0.34, 0.66], rows });
  });

  b.section('Место и сроки проведения', (s) => {
    s.clause(`Сроки проведения: ${dates}.`);
    s.clause(
      place
        ? `Место проведения: ${place}.`
        : 'Место проведения уточняется Организатором и публикуется на странице Соревнования на Платформе.',
    );
    if (f.matCount && f.matCount > 0)
      s.clause(
        `Соревнование проводится на ${f.matCount} ${plural(f.matCount, 'ковре', 'коврах', 'коврах')} с электронными табло Платформы.`,
      );
    s.clause('Программа Соревнования:');
    const rows: string[][] = [];
    rows.push(
      f.registration
        ? [
            `${formatDateTimeRu(f.registration.startsAt, tz)} – ${formatDateTimeRu(f.registration.endsAt, tz)}`,
            'Приём заявок на Платформе',
          ]
        : ['Устанавливаются Платформой', 'Приём заявок на Платформе'],
    );
    const firstWeighIn = [...f.weighIns].sort((x, y) => x.startsAt.localeCompare(y.startsAt))[0];
    rows.push([
      f.registration && firstWeighIn
        ? `${formatDateTimeRu(f.registration.endsAt, tz)} – ${formatDateTimeRu(firstWeighIn.startsAt, tz)}`
        : 'После окончания приёма заявок',
      'Мандатная комиссия: проверка заявок и документов на Платформе',
    ]);
    if (f.weighIns.length > 0) {
      for (const w of [...f.weighIns].sort((x, y) => x.startsAt.localeCompare(y.startsAt)))
        rows.push([
          formatWindowRu(w.startsAt, w.endsAt, tz),
          `${w.official ? 'Взвешивание' : 'Контрольное взвешивание'}${w.name.trim() ? `: ${w.name.trim()}` : ''}`,
        ]);
    } else rows.push([`${dates}, по расписанию Платформы`, 'Взвешивание участников']);
    rows.push([
      'После окончания взвешивания',
      'Жеребьёвка (автоматически на Платформе), публикация турнирных сеток',
    ]);
    rows.push([dates, 'Схватки по расписанию на Платформе; награждение победителей и призёров']);
    s.add({ kind: 'table', columns: ['Дата и время', 'Мероприятие'], widths: [0.42, 0.58], rows });
    s.add({
      kind: 'note',
      text: 'Точное расписание схваток по коврам, турнирные сетки и результаты публикуются в реальном времени на странице Соревнования на Платформе.',
    });
  });

  b.section('Обеспечение безопасности участников и зрителей', (s) => {
    s.clause(
      `Обеспечение безопасности участников и зрителей осуществляется в соответствии с ${SAFETY_353}, а также требованиями правил вида спорта «самбо».`,
    );
    s.clause(
      'Соревнование проводится на объекте спорта, отвечающем требованиям нормативных правовых актов, направленных на обеспечение общественного порядка и безопасности участников и зрителей.',
    );
    s.clause(
      `Оказание медицинской помощи осуществляется в соответствии с ${MEDICAL_1144}. Во время Соревнования обязательно присутствие квалифицированного медицинского персонала.`,
    );
  });

  b.section('Страхование участников', (s) => {
    s.clause(
      'Участие в Соревновании осуществляется только при наличии договора (полиса) страхования жизни и здоровья от несчастных случаев, действующего в дни Соревнования. Договор представляется на мандатную комиссию — загружается на Платформе в разделе «Мои документы» спортсмена.',
    );
    s.clause(
      'Страхование участников производится за счёт командирующих организаций или законных представителей спортсменов.',
    );
  });

  b.section('Антидопинговое обеспечение', (s) => {
    s.clause(
      `Каждый участник, тренер и представитель обязан соблюдать требования ${ANTIDOPING_464}, и требования Всемирного антидопингового агентства. Применение допинга запрещено.`,
    );
  });

  b.section('Требования к участникам и условия их допуска', (s) => {
    s.clause(
      'К Соревнованию допускаются спортсмены спортивных организаций, зарегистрированные на Платформе, по заявке тренера или руководителя спортивной организации, имеющие медицинский допуск и необходимые документы.',
    );
    if (f.genderMode) s.clause(GENDER_MODE_TEXT[f.genderMode]);
    if (f.ageGroups.length > 0) {
      s.clause('Возрастные группы и весовые категории:');
      const rows: string[][] = [];
      for (const g of f.ageGroups) {
        const years = birthYears(g, f.agePolicy, year);
        for (const d of g.divisions) {
          rows.push([
            participantsNoun(d.gender, g.ageTo, g.ageFrom),
            years ? `${ageLabel(g)}\n${years}` : ageLabel(g),
            d.weights.length > 0 ? `${weightsLine(d.weights)} кг` : 'по итогам взвешивания',
          ]);
        }
      }
      s.add({
        kind: 'table',
        columns: ['Участники', 'Возраст', 'Весовые категории'],
        widths: [0.3, 0.24, 0.46],
        rows,
      });
      s.clause(
        f.agePolicy === 'EXACT_ON_DATE'
          ? 'Возраст участника определяется полным числом лет на день начала Соревнования.'
          : 'Возраст участника определяется по году рождения: учитывается возраст, которого спортсмен достигает в год проведения Соревнования.',
      );
    } else {
      s.clause(
        'Возрастные группы и весовые категории устанавливаются Платформой по согласованию с Организатором и публикуются на странице Соревнования до начала приёма заявок.',
      );
    }
    // Правки 07.11.2026, п. 13: требования допуска едины для всех турниров — пять документов, которые спортсмен
    // загружает в «Мои документы» на Платформе; других требований к участию нет.
    s.clause(
      'Требования к допуску едины для всех соревнований Платформы. Спортсмен загружает в раздел «Мои документы» на Платформе следующие документы, их проверяет мандатная комиссия:',
    );
    const extra = f.extraDocuments
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .map((d) => `${d.charAt(0).toLowerCase()}${d.slice(1)};`);
    const items = [...STANDARD_DOCUMENTS];
    if (extra.length > 0) {
      items[items.length - 1] = (items[items.length - 1] ?? '').replace(/\.$/, ';');
      const last = extra.length - 1;
      items.push(...extra.map((d, i) => (i === last ? d.replace(/;$/, '.') : d)));
    }
    s.add({ kind: 'bullets', items });
    s.clause(
      'Участники выступают в спортивной форме для самбо (куртка самбо, шорты, борцовская обувь) красного и синего цветов в соответствии с правилами вида спорта «самбо».',
    );
  });

  b.section('Заявки на участие', (s) => {
    s.clause(
      f.registration
        ? `Заявки на участие подаются только через Платформу «Цифровое Самбо» (${displayUrl(f.platformUrl)}) с ${formatDateTimeRu(f.registration.startsAt, tz)} по ${formatDateTimeRu(f.registration.endsAt, tz)} (время ${tzLabel(tz)}).`
        : `Заявки на участие подаются только через Платформу «Цифровое Самбо» (${displayUrl(f.platformUrl)}). Сроки приёма заявок устанавливаются Платформой и публикуются на странице Соревнования.`,
    );
    s.clause(
      'Заявку подаёт тренер — на своих спортсменов — или руководитель спортивной организации — на спортсменов своего клуба с указанием тренера каждого спортсмена. В заявке указываются весовая категория спортсмена и загружаются необходимые документы.',
    );
    s.clause(
      'Мандатная комиссия проверяет заявки на Платформе. Новые заявки на этапе мандатной комиссии не принимаются; по требованию комиссии заявитель исправляет сведения или документы. Заявка, не исправленная до окончания мандатной комиссии, отклоняется автоматически.',
    );
    s.clause(
      'На взвешивании спортсмен предъявляет QR-код из личного кабинета на Платформе. ' +
        (f.weighInFailureOutcome
          ? WEIGH_IN_OUTCOME_TEXT[f.weighInFailureOutcome]
          : WEIGH_IN_OUTCOME_TEXT.WITHDRAW),
    );
    if (f.pageUrl) s.add({ kind: 'note', text: `Страница Соревнования на Платформе: ${f.pageUrl}` });
  });

  b.section('Система проведения и условия подведения итогов', (s) => {
    s.clause(
      'Соревнование личное. Схватки проводятся по правилам вида спорта «самбо»; продолжительность схватки — в соответствии с правилами для соответствующей возрастной группы.',
    );
    s.clause(
      'Соревнование проводится по рейтинговой групповой системе Платформы: спортсмены весовой категории распределяются по подгруппам «змейкой» по рейтингу Elo, внутри подгруппы схватки проводятся по круговой системе, лучшие выходят в финальную часть с выбыванием:',
    );
    s.add({
      kind: 'table',
      columns: ['Участников в категории', 'Подгруппы', 'Финальная часть'],
      widths: [0.3, 0.36, 0.34],
      rows: [
        ['3–5', 'одна, круговая система', 'нет, места — по итогам круга'],
        ['6–11', '2 подгруппы, выходят по 2', 'полуфиналы и финал'],
        ['12–23', '4 подгруппы, выходят по 2', 'четвертьфиналы, полуфиналы, финал'],
        ['24–39', '8 подгрупп, выходит по 1', 'четвертьфиналы, полуфиналы, финал'],
      ],
    });
    s.clause(
      'В каждой весовой категории разыгрываются первое, второе и два третьих места: схватка за третье место не проводится, оба проигравших в полуфиналах занимают третье место.',
    );
    s.clause(
      'Результаты Соревнования, протоколы по весовым категориям и изменения рейтинга участников публикуются на Платформе. Протесты подаются в главную судейскую коллегию в порядке, установленном правилами вида спорта «самбо».',
    );
  });

  b.section('Награждение', (s) => {
    s.clause(
      'Победители и призёры Соревнования в каждой весовой категории награждаются медалями и грамотами (дипломами) соответствующих степеней.',
    );
    s.clause('Организатор и партнёры вправе устанавливать дополнительные призы и номинации.');
  });

  b.section('Условия финансирования', (s) => {
    s.clause(
      'Расходы по организации и проведению Соревнования несёт Организатор за счёт собственных и привлечённых средств.',
    );
    s.clause(
      'Расходы, связанные с участием в Соревновании (проезд, проживание, питание, страхование участников), несут командирующие организации или законные представители спортсменов.',
    );
  });

  b.section('Персональные данные', (s) => {
    s.clause(
      'Подача заявки на участие означает согласие законного представителя спортсмена (совершеннолетнего спортсмена) на обработку его персональных данных в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» в целях организации Соревнования, учёта результатов и расчёта рейтинга, а также на публикацию фамилии, имени, спортивной организации, результатов и рейтинга на Платформе.',
    );
  });

  if (f.extraConditionsMd && f.extraConditionsMd.trim().length > 0) {
    const paragraphs = plainParagraphs(f.extraConditionsMd);
    if (paragraphs.length > 0)
      b.section('Дополнительные условия', (s) => paragraphs.forEach((p) => s.clause(p)));
  }

  b.section('Контакты', (s) => {
    const rows: string[][] = [['Организатор', f.organizer.name]];
    const orgContacts = [
      f.organizer.phone ? `тел. ${f.organizer.phone}` : null,
      f.organizer.email,
      f.organizer.website,
    ]
      .filter((x): x is string => !!x)
      .join(', ');
    if (orgContacts) rows.push(['Контакты организатора', orgContacts]);
    if (f.responsible) rows.push(['Ответственный за проведение', contactLine(f.responsible)]);
    rows.push(['Платформа «Цифровое Самбо»', f.pageUrl ?? f.platformUrl]);
    s.add({ kind: 'table', columns: ['', ''], widths: [0.34, 0.66], rows });
  });

  const city = f.place.city?.trim() || f.organizer.city?.trim() || null;
  const organizerShort = f.organizer.name;
  return {
    draft: f.draft,
    name: f.name,
    dateLine: dates,
    placeLine: place,
    cityYear: city ? `${city} · ${year}` : String(year),
    approvals: [
      {
        title: 'СОГЛАСОВАНО',
        lines: [
          'Администратор платформы',
          '«Цифровое Самбо»',
          '',
          '____________ / ______________ /',
          '«___» ____________ 20___ г.',
        ],
      },
      {
        title: 'УТВЕРЖДАЮ',
        lines: [
          'Руководитель организации-организатора',
          organizerShort,
          '',
          '____________ / ______________ /',
          '«___» ____________ 20___ г.',
        ],
      },
    ],
    sections: b.sections,
    closing: 'Настоящее Положение является официальным вызовом на Соревнование.',
    generatedLine: `Сформировано платформой «Цифровое Самбо» ${formatDateTimeRu(f.generatedAt.toISOString(), 'Europe/Moscow')} (МСК)`,
  };
}

/** Название в кавычках-ёлочках, если своих кавычек в нём нет. */
export function quoted(name: string): string {
  const n = name.trim();
  return /[«»"„“]/.test(n) ? n : `«${n}»`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function tzLabel(tz: string): string {
  return tz === 'Europe/Moscow' ? 'московское' : tz;
}
