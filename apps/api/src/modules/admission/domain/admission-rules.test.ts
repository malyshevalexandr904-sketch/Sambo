import { admissionStatusOf } from '@sde/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkChanged,
  evaluateCheckIn,
  evaluateConsents,
  evaluateDocuments,
  evaluateMedical,
  evaluateWeight,
  mergeCheck,
  PASSED,
  requiredChecks,
  type RequirementFact,
} from './admission-rules';

const req = (over: Partial<RequirementFact>): RequirementFact => ({
  categoryId: null,
  kind: 'DOCUMENT',
  documentTypeCode: null,
  consentKind: null,
  mandatory: true,
  ...over,
});

describe('required checks from the regulation', () => {
  it('maps mandatory requirements of the competition and the entry category to check kinds', () => {
    const r = requiredChecks(
      [
        req({ kind: 'DOCUMENT', documentTypeCode: 'BIRTH_CERTIFICATE' }),
        req({ kind: 'DOCUMENT', documentTypeCode: 'MEDICAL_CERTIFICATE', categoryId: 'cat-a' }),
        req({ kind: 'DOCUMENT', documentTypeCode: 'PASSPORT', categoryId: 'cat-b' }),
        req({ kind: 'INSURANCE', documentTypeCode: 'INSURANCE_POLICY' }),
        req({ kind: 'CONSENT', consentKind: 'PD_PROCESSING' }),
        req({ kind: 'MEDICAL_CLEARANCE' }),
        req({ kind: 'WEIGH_IN' }),
        req({ kind: 'CHECK_IN', mandatory: false }),
      ],
      'cat-a',
    );
    expect([...r.kinds].sort()).toEqual(['CONSENTS', 'DOCUMENTS', 'INSURANCE', 'MEDICAL', 'WEIGHT']);
    expect(r.documentTypes).toEqual(['BIRTH_CERTIFICATE', 'MEDICAL_CERTIFICATE']);
    expect(r.insuranceTypes).toEqual(['INSURANCE_POLICY']);
    expect(r.consentKinds).toEqual(['PD_PROCESSING']);
  });
});

describe('documents check', () => {
  const on = '2026-11-14';
  const doc = (
    typeCode: string,
    status: 'UPLOADED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED',
    exp: string | null = null,
  ) => ({
    typeCode,
    status,
    expirationDate: exp,
  });

  it('passes with a verified document valid on the start date (the last day counts)', () => {
    expect(evaluateDocuments(['BC'], [doc('BC', 'VERIFIED', on)], on)).toEqual(PASSED);
    expect(evaluateDocuments(['BC'], [doc('BC', 'REJECTED'), doc('BC', 'VERIFIED')], on)).toEqual(PASSED);
  });

  it('waits for review of an uploaded document', () => {
    expect(evaluateDocuments(['BC'], [doc('BC', 'UNDER_REVIEW')], on)).toEqual({
      status: 'PENDING',
      reasonCode: 'document_not_verified',
      reasonParams: { types: ['BC'] },
    });
  });

  it('fails when missing, rejected or expired; the first kind of failure is the reason, all failing types listed', () => {
    expect(evaluateDocuments(['BC', 'INS'], [doc('INS', 'REJECTED')], on)).toEqual({
      status: 'FAILED',
      reasonCode: 'document_missing',
      reasonParams: { types: ['BC', 'INS'] },
    });
    expect(evaluateDocuments(['BC'], [doc('BC', 'REJECTED')], on).reasonCode).toBe('document_rejected');
    expect(evaluateDocuments(['BC'], [doc('BC', 'VERIFIED', '2026-11-13')], on).reasonCode).toBe(
      'document_expired',
    );
    expect(evaluateDocuments(['BC'], [doc('BC', 'EXPIRED')], on).reasonCode).toBe('document_expired');
    // Ожидающий проверки, но просроченный к старту документ допуска не даст.
    expect(evaluateDocuments(['BC'], [doc('BC', 'UPLOADED', '2026-11-01')], on).status).toBe('FAILED');
  });
});

describe('consents, medical, weight, arrival', () => {
  it('consents: every required kind must be active', () => {
    expect(evaluateConsents(['PD_PROCESSING'], new Set(['PD_PROCESSING']))).toEqual(PASSED);
    expect(evaluateConsents(['PD_PROCESSING', 'HEALTH_DATA'], new Set(['PD_PROCESSING']))).toEqual({
      status: 'FAILED',
      reasonCode: 'consent_missing',
      reasonParams: { kinds: ['HEALTH_DATA'] },
    });
  });

  it('medical: valid on the start date passes; latest revoked fails; none waits for the doctor', () => {
    const at = (s: string) => new Date(`${s}T10:00:00Z`);
    const on = '2026-11-14';
    expect(evaluateMedical([{ status: 'VALID', validUntil: on, createdAt: at('2026-10-01') }], on)).toEqual(
      PASSED,
    );
    expect(
      evaluateMedical([{ status: 'VALID', validUntil: '2026-11-13', createdAt: at('2026-10-01') }], on),
    ).toMatchObject({
      status: 'PENDING',
      reasonCode: 'medical_missing',
    });
    expect(
      evaluateMedical(
        [
          { status: 'VALID', validUntil: '2026-11-13', createdAt: at('2026-10-01') },
          { status: 'REVOKED', validUntil: '2026-12-31', createdAt: at('2026-10-05') },
        ],
        on,
      ),
    ).toMatchObject({ status: 'FAILED', reasonCode: 'medical_revoked' });
    expect(evaluateMedical([], on).reasonCode).toBe('medical_missing');
  });

  it('weight and arrival map their statuses', () => {
    expect(evaluateWeight(undefined).reasonCode).toBe('weigh_in_expected');
    expect(
      evaluateWeight({ status: 'PASSED', weightGrams: 37000, lowerGrams: 35000, upperGrams: 38000 }),
    ).toEqual(PASSED);
    expect(
      evaluateWeight({
        status: 'RECHECK_REQUIRED',
        weightGrams: 38500,
        lowerGrams: 35000,
        upperGrams: 38000,
      }),
    ).toMatchObject({
      status: 'PENDING',
      reasonCode: 'weigh_in_recheck_required',
    });
    expect(
      evaluateWeight({ status: 'FAILED', weightGrams: 38500, lowerGrams: 35000, upperGrams: 38000 }),
    ).toEqual({
      status: 'FAILED',
      reasonCode: 'weigh_in_failed',
      reasonParams: { weightGrams: 38500, lowerGrams: 35000, upperGrams: 38000 },
    });
    expect(evaluateCheckIn(undefined).reasonCode).toBe('check_in_expected');
    expect(evaluateCheckIn('ARRIVED')).toEqual(PASSED);
    expect(evaluateCheckIn('NOT_ARRIVED')).toMatchObject({ status: 'FAILED', reasonCode: 'not_arrived' });
    expect(evaluateCheckIn('WITHDRAWN')).toMatchObject({
      status: 'FAILED',
      reasonCode: 'check_in_withdrawn',
    });
  });
});

describe('admission status and waivers', () => {
  it('any failed check — not admitted; otherwise any pending — pending; no checks — admitted', () => {
    expect(admissionStatusOf([])).toBe('ADMITTED');
    expect(admissionStatusOf([{ status: 'PASSED' }, { status: 'WAIVED' }])).toBe('ADMITTED');
    expect(admissionStatusOf([{ status: 'PASSED' }, { status: 'PENDING' }])).toBe('PENDING');
    expect(admissionStatusOf([{ status: 'PENDING' }, { status: 'FAILED' }])).toBe('NOT_ADMITTED');
  });

  it('a waiver survives recomputation and keeps the current reason visible', () => {
    const stored = {
      status: 'WAIVED' as const,
      reasonCode: 'document_missing',
      reasonParams: null,
      waiverReason: 'Оригинал предъявлен',
    };
    const computed = {
      status: 'FAILED' as const,
      reasonCode: 'document_rejected' as const,
      reasonParams: { types: ['BC'] },
    };
    expect(mergeCheck(stored, computed)).toEqual({
      ...computed,
      status: 'WAIVED',
      waiverReason: 'Оригинал предъявлен',
    });
    expect(mergeCheck(undefined, computed)).toEqual({ ...computed, waiverReason: null });
  });

  it('change detection ignores key order of stored parameters (jsonb)', () => {
    const next = {
      status: 'FAILED' as const,
      reasonCode: 'weigh_in_failed' as const,
      reasonParams: { weightGrams: 1, lowerGrams: 2, upperGrams: 3 },
      waiverReason: null,
    };
    const stored = {
      status: 'FAILED' as const,
      reasonCode: 'weigh_in_failed',
      reasonParams: { lowerGrams: 2, upperGrams: 3, weightGrams: 1 },
      waiverReason: null,
    };
    expect(checkChanged(stored, next)).toBe(false);
    expect(checkChanged({ ...stored, status: 'PENDING' }, next)).toBe(true);
  });
});
