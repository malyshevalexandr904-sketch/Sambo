import { describe, expect, it } from 'vitest';
import { publicId, uuidv7 } from './uuid';

describe('uuidv7 (ADR-12)', () => {
  it('produces RFC 9562 version 7 identifiers ordered by time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13).replace('-', '')).toBe((1_700_000_000_000).toString(16).padStart(12, '0'));
  });

  it('is unique within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1)));
    expect(ids.size).toBe(1000);
  });
});

describe('publicId (DATABASE.md, 1.1)', () => {
  it('is 12 base58 characters without look-alike symbols', () => {
    for (let i = 0; i < 200; i++) expect(publicId()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/);
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 2000 }, () => publicId())).size).toBe(2000);
  });
});
