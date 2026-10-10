import { describe, expect, it } from 'vitest';
import { BoundedVersionMemory, type ChangeRow, changedPayload, groupChanges } from './change-routing';

const C1 = '01920000-0000-7000-8000-000000000001';
const C2 = '01920000-0000-7000-8000-000000000002';
const M1 = '01920000-0000-7000-8100-000000000001';
const MAT = '01920000-0000-7000-8200-000000000001';

const row = (p: Partial<ChangeRow>): ChangeRow => ({
  c: C1,
  t: 'match',
  id: M1,
  op: 'UPDATE',
  m: null,
  cat: null,
  mat: null,
  v: '1',
  s: 'SCHEDULED',
  ...p,
});

describe('groupChanges', () => {
  it('groups by tournament and maps tables to topics', () => {
    const [a, b] = groupChanges(
      [
        row({ t: 'check_in', id: 'x', v: null }),
        row({ c: C2, t: 'category_result', id: 'y', cat: 'cat-1', v: null }),
      ],
      new BoundedVersionMemory(),
    );
    expect(a?.competitionId).toBe(C1);
    expect([...(a?.topics ?? [])]).toEqual(['checkin']);
    expect(b?.competitionId).toBe(C2);
    expect([...(b?.topics ?? [])]).toEqual(['results']);
    expect([...(b?.categoryIds ?? [])]).toEqual(['cat-1']);
  });

  it('a match update without a version change is score only: no topic, but the match is touched', () => {
    const memory = new BoundedVersionMemory();
    // Первое знакомство со схваткой — как изменение статуса (версия неизвестна).
    const [first] = groupChanges([row({ v: '3', s: 'IN_PROGRESS', mat: MAT })], memory);
    expect([...(first?.topics ?? [])]).toEqual(['matches']);
    expect([...(first?.statusMatchIds ?? [])]).toEqual([M1]);
    const [score] = groupChanges(
      [row({ v: '3', s: 'IN_PROGRESS', mat: MAT }), row({ t: 'match_event', id: 'e1', m: M1, v: null })],
      memory,
    );
    expect([...(score?.topics ?? [])]).toEqual([]);
    expect([...(score?.matchIds ?? [])]).toEqual([M1]);
    expect([...(score?.matIds ?? [])]).toEqual([MAT]);
    expect([...(score?.statusMatchIds ?? [])]).toEqual([]);
    const [status] = groupChanges([row({ v: '4', s: 'PAUSED' })], memory);
    expect([...(status?.topics ?? [])]).toEqual(['matches']);
  });

  it('rows of a match (result, participants, doctor) touch the match by its id', () => {
    const [g] = groupChanges(
      [
        row({ t: 'match_result', id: 'r1', m: M1, v: '2' }),
        row({ t: 'medical_incident', id: 'i1', m: M1, v: null }),
      ],
      new BoundedVersionMemory(),
    );
    expect([...(g?.matchIds ?? [])]).toEqual([M1]);
    expect([...(g?.statusMatchIds ?? [])]).toEqual([M1]);
    expect(g?.allMats).toBe(false);
  });

  it('deleted matches and session, schedule or crew changes concern every mat', () => {
    const [del] = groupChanges([row({ op: 'DELETE', v: null, s: null })], new BoundedVersionMemory());
    expect(del?.allMats).toBe(true);
    expect([...(del?.deletedMatchIds ?? [])]).toEqual([M1]);
    const [crew] = groupChanges(
      [row({ t: 'mat_assignment', id: 'a1', v: null })],
      new BoundedVersionMemory(),
    );
    expect(crew?.allMats).toBe(true);
    expect([...(crew?.topics ?? [])]).toEqual(['crews']);
  });

  it('ignores rows without a tournament or with an unknown table', () => {
    expect(groupChanges([row({ c: null }), row({ t: 'audit_log' })], new BoundedVersionMemory())).toEqual([]);
  });

  it('builds the payload from the group, with overrides for per-mat and per-match channels', () => {
    const [g] = groupChanges([row({ mat: MAT })], new BoundedVersionMemory());
    expect(changedPayload(g!)).toEqual({
      topics: ['matches'],
      categoryIds: [],
      matIds: [MAT],
      matchIds: [M1],
    });
    expect(changedPayload(g!, { matIds: ['m2'] }).matIds).toEqual(['m2']);
  });
});

describe('BoundedVersionMemory', () => {
  it('forgets the oldest matches beyond the limit', () => {
    const memory = new BoundedVersionMemory(2);
    memory.sameVersion('a', 1);
    memory.sameVersion('b', 1);
    memory.sameVersion('c', 1);
    expect(memory.sameVersion('a', 1)).toBe(false);
    expect(memory.sameVersion('c', 1)).toBe(true);
  });
});
