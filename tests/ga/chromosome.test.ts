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

// Phase 15 task #25 — seeder lecturer distribution
//
// The chromosome seeder owns the initial per-session lecturer assignment
// (`session.lecturerIds`). Two branches:
//   - Single-sibling cohort: every session stamps `candidate.lecturerIds`
//     verbatim (legacy team-teach preserved; lecturer mutation is gated to
//     multi-sibling cohorts, so the seed value is the steady-state value).
//   - Multi-sibling cohort: sessions walk `siblingLecturerGroups` round-
//     robin (`sessions[i].lecturerIds = siblingLecturerGroups[i % groups]`),
//     so each sibling "owns" their share of parallel sessions and team-
//     teach within a sibling is preserved on every session that sibling owns.
describe('createGeneFromCandidate — Phase 15 lecturer distribution', () => {
  it('stamps candidate.lecturerIds on every session for a single-sibling cohort', () => {
    const gene = createGeneFromCandidate(
      baseCandidate({
        offeringId: 1,
        lecturerIds: [100, 200],
        parallelSessionCount: 3,
        siblingOfferingIds: [1],
        lecturerPool: [100, 200],
        siblingLecturerGroups: [[100, 200]],
      }),
    );
    expect(gene.sessions).toHaveLength(3);
    for (const s of gene.sessions) {
      expect(s.lecturerIds).toEqual([100, 200]);
    }
  });

  it('round-robins siblingLecturerGroups across sessions for a multi-sibling cohort', () => {
    // 2 siblings (X=[10], Y=[20]), 4 parallel sessions → sessions get
    // [X], [Y], [X], [Y] in order.
    const gene = createGeneFromCandidate(
      baseCandidate({
        offeringId: 100,
        roomId: null,
        possibleRoomIds: [1, 2, 3, 4],
        lecturerIds: [10],
        parallelSessionCount: 4,
        siblingOfferingIds: [100, 200],
        lecturerPool: [10, 20],
        siblingLecturerGroups: [[10], [20]],
      }),
    );
    expect(gene.sessions).toHaveLength(4);
    expect(gene.sessions[0]!.lecturerIds).toEqual([10]);
    expect(gene.sessions[1]!.lecturerIds).toEqual([20]);
    expect(gene.sessions[2]!.lecturerIds).toEqual([10]);
    expect(gene.sessions[3]!.lecturerIds).toEqual([20]);
  });

  it('preserves team-teach when a sibling has multiple lecturers (OQ-25)', () => {
    // Sibling 0 team-teaches with [10, 11]; sibling 1 has [20] alone.
    // 4 sessions round-robin: [10,11], [20], [10,11], [20].
    const gene = createGeneFromCandidate(
      baseCandidate({
        offeringId: 100,
        roomId: null,
        possibleRoomIds: [1, 2, 3, 4],
        lecturerIds: [10, 11],
        parallelSessionCount: 4,
        siblingOfferingIds: [100, 200],
        lecturerPool: [10, 11, 20],
        siblingLecturerGroups: [[10, 11], [20]],
      }),
    );
    expect(gene.sessions).toHaveLength(4);
    expect(gene.sessions[0]!.lecturerIds).toEqual([10, 11]);
    expect(gene.sessions[1]!.lecturerIds).toEqual([20]);
    expect(gene.sessions[2]!.lecturerIds).toEqual([10, 11]);
    expect(gene.sessions[3]!.lecturerIds).toEqual([20]);
  });

  it('wraps round-robin when parallelSessionCount exceeds siblings.length', () => {
    // 3 siblings, 4 sessions → round-robin gives sibling[0] two sessions
    // (indices 0 and 3) and siblings 1, 2 one each.
    const gene = createGeneFromCandidate(
      baseCandidate({
        offeringId: 100,
        roomId: null,
        possibleRoomIds: [1, 2, 3, 4],
        lecturerIds: [10],
        parallelSessionCount: 4,
        siblingOfferingIds: [100, 200, 300],
        lecturerPool: [10, 20, 30],
        siblingLecturerGroups: [[10], [20], [30]],
      }),
    );
    expect(gene.sessions).toHaveLength(4);
    expect(gene.sessions[0]!.lecturerIds).toEqual([10]);
    expect(gene.sessions[1]!.lecturerIds).toEqual([20]);
    expect(gene.sessions[2]!.lecturerIds).toEqual([30]);
    expect(gene.sessions[3]!.lecturerIds).toEqual([10]);
  });

  it('returns independent lecturerIds arrays per session (no aliasing)', () => {
    // Round-robin re-uses the same sibling group across multiple sessions, so
    // the seeder must clone the array on each session — otherwise a downstream
    // mutator (e.g. mutateLecturer) would inadvertently mutate every session
    // that shares the alias. Mutate the first session's lecturerIds and verify
    // that the third session (same round-robin bucket) is unaffected.
    const gene = createGeneFromCandidate(
      baseCandidate({
        offeringId: 100,
        roomId: null,
        possibleRoomIds: [1, 2, 3, 4],
        lecturerIds: [10],
        parallelSessionCount: 4,
        siblingOfferingIds: [100, 200],
        lecturerPool: [10, 20],
        siblingLecturerGroups: [[10], [20]],
      }),
    );
    gene.sessions[0]!.lecturerIds.push(999);
    expect(gene.sessions[2]!.lecturerIds).toEqual([10]); // not [10, 999]
  });
});
