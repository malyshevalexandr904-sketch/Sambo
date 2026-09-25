import { describe, expect, it } from 'vitest';
import { canDelete, checkReview, isExpired, mimeAllowed } from './document-rules';

describe('document rules (ARCHITECTURE.md, 16.4)', () => {
  it('moves UPLOADED → UNDER_REVIEW → VERIFIED | REJECTED; rejection needs a reason', () => {
    expect(checkReview('UPLOADED', 'UNDER_REVIEW')).toEqual({ ok: true, reasonRequired: false });
    expect(checkReview('UNDER_REVIEW', 'VERIFIED')).toEqual({ ok: true, reasonRequired: false });
    expect(checkReview('UNDER_REVIEW', 'REJECTED')).toEqual({ ok: true, reasonRequired: true });
    expect(checkReview('UPLOADED', 'VERIFIED').ok).toBe(true);
  });

  it('never reviews a document twice', () => {
    expect(checkReview('VERIFIED', 'REJECTED')).toMatchObject({
      ok: false,
      code: 'DOCUMENT_ALREADY_REVIEWED',
    });
    expect(checkReview('REJECTED', 'VERIFIED')).toMatchObject({
      ok: false,
      code: 'DOCUMENT_ALREADY_REVIEWED',
    });
    expect(checkReview('UNDER_REVIEW', 'UNDER_REVIEW')).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
    expect(checkReview('EXPIRED', 'VERIFIED')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('allows deletion only before review', () => {
    expect(canDelete('UPLOADED')).toBe(true);
    expect(canDelete('UNDER_REVIEW')).toBe(false);
  });

  it('expires the day after the expiration date', () => {
    expect(isExpired('2026-09-24', '2026-09-24')).toBe(false);
    expect(isExpired('2026-09-23', '2026-09-24')).toBe(true);
    expect(isExpired(null, '2026-09-24')).toBe(false);
  });

  it('checks MIME against the document type list', () => {
    expect(mimeAllowed('application/pdf,image/jpeg,image/png', 'image/png')).toBe(true);
    expect(mimeAllowed('application/pdf, image/jpeg', 'image/jpeg')).toBe(true);
    expect(mimeAllowed('application/pdf', 'image/svg+xml')).toBe(false);
  });
});
