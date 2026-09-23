import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid';

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
