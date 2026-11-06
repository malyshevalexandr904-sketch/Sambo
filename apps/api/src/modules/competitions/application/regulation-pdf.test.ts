import { describe, expect, it } from 'vitest';
import { buildRegulation, type RegulationFacts } from '../domain/regulation-document';
import { renderRegulationPdf } from './regulation-pdf';

const facts: RegulationFacts = {
  draft: true,
  name: 'Первенство клуба по самбо',
  startDate: '2026-12-12',
  endDate: '2026-12-12',
  timezone: 'Europe/Moscow',
  place: { city: 'Москва', venue: null, address: 'ул. Ленина, 1' },
  organizer: { name: 'Клуб', city: 'Москва', address: null, email: null, phone: null, website: null },
  responsible: null,
  chiefReferee: null,
  chiefSecretary: null,
  matCount: 1,
  genderMode: 'BOYS',
  agePolicy: 'BY_BIRTH_YEAR',
  ageGroups: [
    {
      ageFrom: 9,
      ageTo: 10,
      birthYearFrom: null,
      birthYearTo: null,
      divisions: [{ gender: 'MALE', weights: [{ kind: 'UP_TO', grams: 30000 }] }],
    },
  ],
  registration: null,
  weighIns: [],
  extraDocuments: [],
  extraConditionsMd: null,
  weighInFailureOutcome: null,
  pageUrl: null,
  platformUrl: 'https://digitalsambo.ru',
  generatedAt: new Date('2026-11-05T10:00:00Z'),
};

describe('renderRegulationPdf', () => {
  it('собирает PDF с титульным листом и разделами', async () => {
    const pdf = await renderRegulationPdf(buildRegulation(facts));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(pdf.length).toBeLessThan(1_500_000);
  }, 20_000);
});
