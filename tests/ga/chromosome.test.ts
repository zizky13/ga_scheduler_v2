/**
 * Unit tests for `createGeneFromCandidate` (src/ga/chromosome.ts).
 *
 * Covers Phase 7's nullable `CourseOffering.roomId` migration: when a
 * candidate arrives with `roomId === null`, the seeder picks an initial
 * room uniformly at random from `possibleRoomIds`. The pre-existing
 * non-null path is also exercised to guard against regressions.
 */

import { describe, it, expect } from 'vitest';
import { buildSlotLookup, createGeneFromCandidate } from '../../src/ga/chromosome.js';
import type { PreGACandidate, TimeSlot } from '../../src/types.js';

// Phase 16 #18 fixture — mirrors the same id layout used by the parallel
// fixtures in tests/ga/mutation.test.ts and tests/ga/repair.test.ts so all
// three layers (seeder / mutation / repair) exercise the same same-day-
// anchored selector on byte-identical inputs. Monday holds five same-day
// slots: a 3-slot contiguous run 101→102→103 (08:00–10:30), a 10-minute
// break, then a 2-slot contiguous run 104→105 (10:40–12:20). Tuesday
// carries an independent 3-slot run 201→202→203. No single day has a
// 5-slot contiguous run, so `findContiguousSlots(5)` returns []; the
// fallback path under test (chromosome.ts:pickSameDaySessionSlots) must
// stay same-day.
const PHASE16_FRAGMENTED_SLOTS: TimeSlot[] = [
  { id: 101, day: 'Mon', startTime: '08:00', endTime: '08:50' },
  { id: 102, day: 'Mon', startTime: '08:50', endTime: '09:40' },
  { id: 103, day: 'Mon', startTime: '09:40', endTime: '10:30' },
  { id: 104, day: 'Mon', startTime: '10:40', endTime: '11:30' },
  { id: 105, day: 'Mon', startTime: '11:30', endTime: '12:20' },
  { id: 201, day: 'Tue', startTime: '08:00', endTime: '08:50' },
  { id: 202, day: 'Tue', startTime: '09:00', endTime: '09:50' },
  { id: 203, day: 'Tue', startTime: '10:00', endTime: '10:50' },
];

const PHASE16_LOOKUP = buildSlotLookup(PHASE16_FRAGMENTED_SLOTS);

function slotDays(slotIds: number[]): string[] {
  return slotIds.map((id) => PHASE16_LOOKUP.get(id)!.day);
}

function fragmentedFiveSksCandidate(): PreGACandidate {
  return {
    offeringId: 1604,
    courseId: 16,
    roomId: null,
    lecturerIds: [88],
    effectiveStudentCount: 30,
    parallelSessionCount: 1,
    sessionDuration: 5,
    possibleTimeSlotIds: PHASE16_FRAGMENTED_SLOTS.map((slot) => slot.id),
    possibleRoomIds: [41, 42],
    isFixedRoom: false,
    siblingOfferingIds: [1604],
    lecturerPool: [88],
    siblingLecturerGroups: [[88]],
    longestContiguousRun: 3,
    fragmentationRequired: true,
  };
}

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

// Phase 16 #18 — the chromosome seeder must never cross days when filling a
// session whose `sessionDuration` exceeds the timetable's `longestContiguous
// Run` (OQ-33 default). The pre-Phase-16 fallback `fisherYatesShuffle(possible
// TimeSlotIds).slice(i*sks, (i+1)*sks)` silently spanned days; the Phase 16 #4
// replacement (chromosome.ts:pickSameDaySessionSlots) anchors every session
// to one day even when that day cannot supply a contiguous block of the
// requested duration. The sibling tests in tests/ga/mutation.test.ts
// (`mutateChromosome — Phase 16 #5`) and tests/ga/repair.test.ts
// (`repairChromosome — Phase 16 #7`) cover the same contract for mutation
// and repair so all three layers stay in lockstep.
describe('createGeneFromCandidate — Phase 16 #4 same-day fragmented fallback', () => {
  it('seeds a FLEXIBLE 5-SKS session entirely on one day when no day holds a 5-slot contiguous run', () => {
    const candidate = fragmentedFiveSksCandidate();

    // Run repeatedly: the helper picks the day with the longest run, and ties
    // are broken uniformly at random for diversity. Mon is the unique longest-
    // run day (3 vs Tue's 3 also — actually Tue also has a 3-slot run, so the
    // tie-break could pick either day on a given draw. The contract being
    // tested is "all five session slots fall on a single day", not "always
    // Monday" — so the loop just asserts the invariant holds every time).
    for (let trial = 0; trial < 25; trial += 1) {
      const gene = createGeneFromCandidate(candidate, PHASE16_LOOKUP);

      expect(gene.kind).toBe('FLEXIBLE');
      expect(gene.sessions).toHaveLength(1);
      const session = gene.sessions[0]!;

      // The seeder may return fewer than `sessionDuration` slots only in
      // path-C degenerate cases (chromosome.ts docblock). For this fixture
      // both days have ≥ 5 slots when Mon is picked, and Tue has only 3 —
      // so we accept either "5 slots all-Mon" or "≤ 3 slots all-Tue" while
      // pinning the invariant: the slots that ARE picked are same-day.
      const days = new Set(slotDays(session.timeSlotIds));
      expect(days.size).toBe(1);
      // FLEXIBLE: roomId must come from possibleRoomIds.
      expect(candidate.possibleRoomIds!).toContain(session.roomId);
    }
  });

  it('seeds a FIXED 5-SKS session same-day while preserving the locked roomId', () => {
    const candidate: PreGACandidate = {
      ...fragmentedFiveSksCandidate(),
      roomId: 41,
      isFixedRoom: true,
    };

    for (let trial = 0; trial < 25; trial += 1) {
      const gene = createGeneFromCandidate(candidate, PHASE16_LOOKUP);

      expect(gene.kind).toBe('FIXED');
      expect(gene.sessions).toHaveLength(1);
      const session = gene.sessions[0]!;

      // FIXED: roomId is the locked candidate.roomId verbatim — not a draw.
      expect(session.roomId).toBe(41);
      const days = new Set(slotDays(session.timeSlotIds));
      expect(days.size).toBe(1);
    }
  });
});
