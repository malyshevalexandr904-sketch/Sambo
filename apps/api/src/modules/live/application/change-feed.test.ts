import { describe, expect, it } from 'vitest';
import { parseChange } from './change-feed.service';

const C1 = '01920000-0000-7000-8000-000000000001';
const M1 = '01920000-0000-7000-8100-000000000001';

describe('parseChange', () => {
  it('parses a notification of the live feed and rejects foreign payloads', () => {
    const payload = JSON.stringify({ c: C1, t: 'match', id: M1, op: 'UPDATE', m: null, v: '2', s: 'READY' });
    expect(parseChange(payload)).toMatchObject({
      c: C1,
      t: 'match',
      id: M1,
      op: 'UPDATE',
      v: '2',
      s: 'READY',
    });
    expect(parseChange('not json')).toBeNull();
    expect(parseChange(JSON.stringify({ t: 'match', op: 'TRUNCATE' }))).toBeNull();
    expect(parseChange(undefined)).toBeNull();
  });
});
