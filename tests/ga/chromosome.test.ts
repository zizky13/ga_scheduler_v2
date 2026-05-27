/**
 * Unit tests for `createGeneFromCandidate` (src/ga/chromosome.ts).
 *
 * Covers Phase 7's nullable `CourseOffering.roomId` migration: when a
 * candidate arrives with `roomId === null`, the seeder picks an initial
 * room uniformly at random from `possibleRoomIds`. The pre-existing
 * non-null path is also exercised to guard against regressions.
 */

import { describe, it, expect } from 'vitest';
import { createGeneFromCandidate } from '../../src/ga/chromosome.js';
import type { PreGACandidate } from '../../src/types.js';

function baseCandidate(overrides: Partial<PreGACandidate> = {}): PreGACandidate {
  return {
    offeringId: 1,
    courseId: 10,
    roomId: 5,
    lecturerIds: [100],
    effectiveStudentCount: 30,
    parallelSessionCount: 1,
    sessionDuration: 1,
    possibleTimeSlotIds: [1, 2, 3, 4, 5],
    possibleRoomIds: [1, 2, 3, 4, 5],
    isFixedRoom: false,
    siblingOfferingIds: [1],
    lecturerPool: [100],
    siblingLecturerGroups: [[100]],
    ...overrides,
  };
}

describe('createGeneFromCandidate — roomId seed', () => {
  it('uses candidate.roomId verbatim when non-null (FLEXIBLE)', () => {
    const gene = createGeneFromCandidate(baseCandidate({ roomId: 5 }));
    expect(gene.kind).toBe('FLEXIBLE');
    for (const s of gene.sessions) {
      expect(s.roomId).toBe(5);
    }
  });

  it('uses candidate.roomId verbatim when non-null (FIXED)', () => {
    const gene = createGeneFromCandidate(
      baseCandidate({ roomId: 7, isFixedRoom: true })
    );
    expect(gene.kind).toBe('FIXED');
    for (const s of gene.sessions) {
      expect(s.roomId).toBe(7);
    }
  });

  it('picks the seed room from possibleRoomIds when roomId is null', () => {
    const pool = [10, 11, 12];
    const gene = createGeneFromCandidate(
      baseCandidate({ roomId: null, possibleRoomIds: pool })
    );
    expect(gene.sessions.length).toBeGreaterThan(0);
    for (const s of gene.sessions) {
      expect(pool).toContain(s.roomId);
    }
  });

  it('distributes the random seed across possibleRoomIds over many runs', () => {
    const pool = [10, 11, 12, 13];
    const observed = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const gene = createGeneFromCandidate(
        baseCandidate({
          offeringId: i,
          roomId: null,
          possibleRoomIds: pool,
        })
      );
      observed.add(gene.sessions[0]!.roomId);
    }
    // Probability of missing any one bucket across 200 picks with |pool|=4
    // is (3/4)^200 ≈ 1e-25, so this assertion is effectively deterministic.
    expect(observed.size).toBe(pool.length);
  });

  it('applies the same seed to every parallel session', () => {
    const pool = [21];
    const gene = createGeneFromCandidate(
      baseCandidate({
        roomId: null,
        possibleRoomIds: pool,
        parallelSessionCount: 3,
      })
    );
    expect(gene.sessions).toHaveLength(3);
    for (const s of gene.sessions) {
      expect(s.roomId).toBe(21);
    }
  });

  it('throws when roomId is null and possibleRoomIds is empty', () => {
    expect(() =>
      createGeneFromCandidate(
        baseCandidate({ roomId: null, possibleRoomIds: [] })
      )
    ).toThrow(/null roomId and empty possibleRoomIds/);
  });

  it('throws when roomId is null and possibleRoomIds is omitted', () => {
    const c = baseCandidate({ roomId: null });
    delete c.possibleRoomIds;
    expect(() => createGeneFromCandidate(c)).toThrow(
      /null roomId and empty possibleRoomIds/
    );
  });
});
