import { describe, expect, it } from 'vitest';
import { documentReadiness, isReadinessBlocking, type ReadinessDocumentFact } from './admission';

const ok = (typeCode: string, expirationDate: string | null = null): ReadinessDocumentFact => ({
  typeCode,
  status: 'VERIFIED',
  expirationDate,
});
const adult = ['PASSPORT', 'OMS_POLICY', 'MEDICAL_CERTIFICATE', 'INSURANCE_POLICY'];

describe('documentReadiness', () => {
  it('OK, когда все документы проверены и действуют на дату турнира', () => {
    const r = documentReadiness(
      18,
      false,
      adult.map((x) => ok(x, '2027-01-01')),
      '2026-12-01',
    );
    expect(r).toEqual({ state: 'OK', missing: [], expired: [], pending: [] });
    expect(isReadinessBlocking(r.state)).toBe(false);
  });

  it('MISSING, если документа нет или он отклонён', () => {
    const docs = [
      ...adult.filter((x) => x !== 'OMS_POLICY').map((x) => ok(x)),
      {
        typeCode: 'MEDICAL_CERTIFICATE',
        status: 'REJECTED' as const,
        expirationDate: null,
      },
    ];
    const r = documentReadiness(18, true, docs, '2026-12-01');
    expect(r.state).toBe('MISSING');
    expect(r.missing).toEqual(['OMS_POLICY', 'SPORT_RANK_ORDER']);
    expect(isReadinessBlocking(r.state)).toBe(true);
  });

  it('EXPIRED, если срок истекает до начала турнира', () => {
    const docs = adult.map((x) => (x === 'MEDICAL_CERTIFICATE' ? ok(x, '2026-11-30') : ok(x)));
    const r = documentReadiness(18, false, docs, '2026-12-01');
    expect(r.state).toBe('EXPIRED');
    expect(r.expired).toEqual(['MEDICAL_CERTIFICATE']);
  });

  it('PENDING — загружен, но ещё не проверен; не блокирует', () => {
    const docs = adult.map((x) =>
      x === 'PASSPORT' ? { typeCode: x, status: 'UPLOADED' as const, expirationDate: null } : ok(x),
    );
    const r = documentReadiness(18, false, docs, '2026-12-01');
    expect(r.state).toBe('PENDING');
    expect(isReadinessBlocking(r.state)).toBe(false);
  });

  it('детям нужны свидетельство о рождении и справка из школы', () => {
    const r = documentReadiness(12, false, [], '2026-12-01');
    expect(r.missing).toContain('BIRTH_CERTIFICATE');
    expect(r.missing).toContain('SCHOOL_CERTIFICATE');
    expect(r.missing).not.toContain('PASSPORT');
  });
});
