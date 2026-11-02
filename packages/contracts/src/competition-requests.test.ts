// Заявка на проведение турнира (описание процесса, 02.11.2026): форма и расчёт минимальных требований.
import { describe, expect, it } from 'vitest';
import {
  CompetitionRequestCreate,
  CompetitionRequestProposal,
  hostingRequirements,
  maskEmail,
} from './competition-requests.js';

const ORG = '0192f0c4-0000-7000-8000-000000000001';
const AG1 = '0192f0c4-0000-7000-8000-000000000002';
const AG2 = '0192f0c4-0000-7000-8000-000000000003';
const AG3 = '0192f0c4-0000-7000-8000-000000000004';

const valid = {
  organizationId: ORG,
  name: 'Открытое первенство клуба',
  startDate: '2026-12-12',
  address: 'г. Москва, ул. Спортивная, д. 1, СК «Самбо-70»',
  ageGroupIds: [AG1, AG2],
  matCount: 3,
  equipment: 'PARTIAL',
  refereeTeam: 'NONE',
  gender: 'SEPARATE',
  responsible: { kind: 'SELF' },
  rulesAccepted: true,
};

const fields = (body: unknown): string[] => {
  const r = CompetitionRequestCreate.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('hostingRequirements', () => {
  it('per mat: laptop, TV, mat chief and timekeeper; per age group per mat: arbiter and side judge', () => {
    expect(hostingRequirements(3, 2)).toEqual({
      laptops: 3,
      tvs: 3,
      wifi: true,
      matHeads: 3,
      arbiters: 6,
      sideJudges: 6,
      timekeepers: 3,
    });
  });
  it('no age group chosen yet counts as one', () => {
    expect(hostingRequirements(2, 0).arbiters).toBe(2);
  });
});

describe('CompetitionRequestCreate', () => {
  it('accepts the complete form', () => {
    expect(fields(valid)).toEqual([]);
  });
  it('requires consent to the rules', () => {
    expect(fields({ ...valid, rulesAccepted: false })).toEqual(['rulesAccepted:consent_required']);
  });
  it('allows at most two age groups, without repeats', () => {
    expect(fields({ ...valid, ageGroupIds: [AG1, AG2, AG3] })).toEqual(['ageGroupIds:too_many']);
    expect(fields({ ...valid, ageGroupIds: [AG1, AG1] })).toEqual(['ageGroupIds:duplicate']);
  });
  it('checks mats, address and the choices', () => {
    expect(fields({ ...valid, matCount: 0 })).toEqual(['matCount:required']);
    expect(fields({ ...valid, matCount: 21 })).toEqual(['matCount:too_many']);
    expect(fields({ ...valid, address: 'Мск' })).toEqual(['address:too_short']);
    expect(fields({ ...valid, gender: 'ALL' })).toHaveLength(1);
  });
  it('the person in charge: a registered user by email or contacts with a phone or an email', () => {
    expect(fields({ ...valid, responsible: { kind: 'USER', userId: AG3 } })).toEqual([]);
    expect(
      fields({ ...valid, responsible: { kind: 'CONTACT', fullName: 'Иванов Иван', phone: '+79991234567' } }),
    ).toEqual([]);
    expect(fields({ ...valid, responsible: { kind: 'CONTACT', fullName: 'Иванов Иван' } })).toEqual([
      'responsible.phone:contact_required',
    ]);
  });
});

describe('CompetitionRequestProposal', () => {
  it('still reads requests submitted before the new form', () => {
    const old = CompetitionRequestProposal.safeParse({
      name: 'Кубок клуба',
      timezone: 'Europe/Moscow',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      registrationStartsAt: '2026-10-01T00:00:00.000Z',
      registrationEndsAt: '2026-10-30T00:00:00.000Z',
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
    });
    expect(old.success).toBe(true);
  });
});

describe('maskEmail', () => {
  it('hides most of the local part', () => {
    expect(maskEmail('ivanov@mail.ru')).toBe('iv****@mail.ru');
    expect(maskEmail('ab@x.ru')).toBe('a***@x.ru');
  });
});
