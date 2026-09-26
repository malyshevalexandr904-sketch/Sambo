import { describe, expect, it } from 'vitest';
import { holdsWriteAuthority } from './write-authority';

const cloud = { mode: 'cloud' as const, nodeId: null };
const node = { mode: 'venue-node' as const, nodeId: 'node-1' };

describe('holdsWriteAuthority', () => {
  it('cloud writes while it holds the lease or no lease exists', () => {
    expect(holdsWriteAuthority(null, cloud)).toBe(true);
    expect(holdsWriteAuthority({ holderType: 'CLOUD', holderNodeId: null, epoch: 1 }, cloud)).toBe(true);
  });

  it('cloud refuses writes while a venue node holds the lease', () => {
    expect(holdsWriteAuthority({ holderType: 'NODE', holderNodeId: 'node-1', epoch: 2 }, cloud)).toBe(false);
  });

  it('a node writes only the competition leased to it', () => {
    expect(holdsWriteAuthority({ holderType: 'NODE', holderNodeId: 'node-1', epoch: 2 }, node)).toBe(true);
    expect(holdsWriteAuthority({ holderType: 'NODE', holderNodeId: 'node-2', epoch: 2 }, node)).toBe(false);
    expect(holdsWriteAuthority({ holderType: 'CLOUD', holderNodeId: null, epoch: 3 }, node)).toBe(false);
    expect(holdsWriteAuthority(null, node)).toBe(false);
  });
});
