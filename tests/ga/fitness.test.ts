/**
 * evaluateHardFitness — nested sessions[] collision counting (Task 20).
 *
 * Verifies room/lecturer collision counts for the new
 * gene.sessions[]{roomId, timeSlotIds, lecturerIds} shape, including:
 *   - cross-gene room collisions
 *   - cross-gene lecturer collisions
 *   - intra-gene parallel-session collisions
 *   - multi-slot contiguous-block overlaps
 *
 * Phase 15 #8: lecturer collisions read `session.lecturerIds`, so the
 * `flex(...)` helper stamps lecturerIds onto every session of the gene
 * (mirroring the chromosome seeder's single-sibling default — every
 * session shares the same lecturer set). Tests that don't care about
 * lecturers pass `[]` (the room-only / capacity-shortfall paths).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFitness,
  evaluateHardFitness,
  calculateStructuralPenalty,
  calculatePreferencePenalty,
  calculateLoadPenalty,
  calculateCapacityShortfallPenalty,
  calculateLecturerDistributionEntropy,
} from '../../src/ga/fitness.js';
import type { Chromosome, FlexibleGene, PreGACandidate, Room } from '../../src/types.js';

function flex(
  offeringId: number,
  sessions: { roomId: number; timeSlotIds: number[]; lecturerIds?: number[] }[],
  defaultLecturerIds: number[] = [],
): FlexibleGene {
  return {
    kind: 'FLEXIBLE',
    offeringId,
    sessions: sessions.map(s => ({
      roomId: s.roomId,
      timeSlotIds: s.timeSlotIds,
      lecturerIds: s.lecturerIds ?? [...defaultLecturerIds],
    })),
  };
}

function candidate(
  offeringId: number,
  lecturerIds: number[],
  sessionDuration = 1,
): PreGACandidate {
  return {
    offeringId,
    courseId: offeringId * 10,
    roomId: 1,
    lecturerIds,
    effectiveStudentCount: 30,
    parallelSessionCount: 1,
    sessionDuration,
    possibleTimeSlotIds: [],
    isFixedRoom: false,
  };
}

describe('evaluateHardFitness — nested sessions', () => {
  it('returns 0 when no collisions exist', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100]),
      flex(2, [{ roomId: 11, timeSlotIds: [6] }], [101]),
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(0);
  });

  it('counts cross-gene room collision at the same slot', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100]),
      flex(2, [{ roomId: 10, timeSlotIds: [5] }], [101]), // same room, same slot
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(1);
  });

  it('counts cross-gene lecturer collision at the same slot', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100]),
      flex(2, [{ roomId: 11, timeSlotIds: [5] }], [100]),
    ];
    const cands = [candidate(1, [100]), candidate(2, [100])]; // shared lecturer
    expect(evaluateHardFitness(chrom, cands)).toBe(1);
  });

  it('counts intra-gene lecturer collision when parallel sessions overlap in time', () => {
    // One offering with 2 parallel groups at the SAME slot — same lecturer
    // can't physically run both simultaneously.
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [5] },
        { roomId: 11, timeSlotIds: [5] },
      ], [100]),
    ];
    const cands = [candidate(1, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(1);
  });

  it('does NOT count lecturer collision for parallel sessions at different slots', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [5] },
        { roomId: 11, timeSlotIds: [6] },
      ], [100]),
    ];
    const cands = [candidate(1, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(0);
  });

  it('counts intra-gene room collision when parallel sessions share a room', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [5] },
        { roomId: 10, timeSlotIds: [5] }, // same room and slot — illegal
      ], [100]),
    ];
    const cands = [candidate(1, [100])];
    // Both room and lecturer collide → 2 violations
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts each overlapping slot in multi-slot contiguous blocks', () => {
    // Two genes: contiguous 3-slot blocks share room at slots 5 and 6.
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5, 6, 7] }], [100]),
      flex(2, [{ roomId: 10, timeSlotIds: [4, 5, 6] }], [101]),
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    // Slots 5 and 6 overlap → 2 room violations
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts both room and lecturer violations independently', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100]),
      flex(2, [{ roomId: 10, timeSlotIds: [5] }], [100]), // shared room AND shared lecturer
    ];
    const cands = [candidate(1, [100]), candidate(2, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts team-teaching lecturer collisions per lecturer', () => {
    // gene 1 lectured by [100, 101]; gene 2 lectured by [100, 101] at same slot.
    // Both lecturers collide → 2 lecturer violations.
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100, 101]),
      flex(2, [{ roomId: 11, timeSlotIds: [5] }], [100, 101]),
    ];
    const cands = [candidate(1, [100, 101]), candidate(2, [100, 101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });
});

describe('calculateStructuralPenalty — nested sessions', () => {
  it('returns 0 when no lecturer is structural', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
    ];
    const cands = [candidate(1, [100])];
    const structural = new Map<number, boolean>([[100, false]]);
    expect(calculateStructuralPenalty(chrom, cands, structural)).toBe(0);
  });

  it('returns 0 when slot count is at or below max (2)', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2] }], [100]),
    ];
    const cands = [candidate(1, [100])];
    const structural = new Map<number, boolean>([[100, true]]);
    expect(calculateStructuralPenalty(chrom, cands, structural)).toBe(0);
  });

  it('counts slots across all parallel sessions of a single gene', () => {
    // 2 parallel sessions × 2 slots each = 4 slots → penalty = 4 - 2 = 2.
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1, 2] },
        { roomId: 11, timeSlotIds: [3, 4] },
      ], [100]),
    ];
    const cands = [candidate(1, [100])];
    const structural = new Map<number, boolean>([[100, true]]);
    expect(calculateStructuralPenalty(chrom, cands, structural)).toBe(2);
  });

  it('aggregates slots across multiple genes per structural lecturer', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2] }], [100]),  // 2 slots
      flex(2, [{ roomId: 11, timeSlotIds: [3, 4, 5] }], [100]), // 3 slots
    ];
    const cands = [candidate(1, [100]), candidate(2, [100])];
    const structural = new Map<number, boolean>([[100, true]]);
    // 5 total slots − 2 max = 3
    expect(calculateStructuralPenalty(chrom, cands, structural)).toBe(3);
  });

  it('only counts structural lecturers when team-teaching', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3, 4] }], [100, 101]),
    ];
    const cands = [candidate(1, [100, 101])]; // 100 structural, 101 not
    const structural = new Map<number, boolean>([[100, true], [101, false]]);
    expect(calculateStructuralPenalty(chrom, cands, structural)).toBe(2);
  });
});

describe('calculatePreferencePenalty — nested sessions', () => {
  it('returns 0 when lecturer has no preferences', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
    ];
    const cands = [candidate(1, [100])];
    const prefs = new Map<number, Set<number>>(); // empty
    expect(calculatePreferencePenalty(chrom, cands, prefs)).toBe(0);
  });

  it('returns 0 when all assigned slots are preferred', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
    ];
    const cands = [candidate(1, [100])];
    const prefs = new Map<number, Set<number>>([[100, new Set([1, 2, 3])]]);
    expect(calculatePreferencePenalty(chrom, cands, prefs)).toBe(0);
  });

  it('counts each non-preferred slot across all sessions', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1, 2] },  // 1 preferred, 2 not
        { roomId: 11, timeSlotIds: [3, 4] },  // both not preferred
      ], [100]),
    ];
    const cands = [candidate(1, [100])];
    const prefs = new Map<number, Set<number>>([[100, new Set([1])]]);
    // Slots [2, 3, 4] are non-preferred → penalty = 3
    expect(calculatePreferencePenalty(chrom, cands, prefs)).toBe(3);
  });

  it('charges each lecturer separately when team-teaching', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }], [100, 101]),
    ];
    const cands = [candidate(1, [100, 101])];
    const prefs = new Map<number, Set<number>>([
      [100, new Set([1, 2])], // slot 5 not preferred for 100
      [101, new Set([5])],    // slot 5 preferred for 101
    ]);
    expect(calculatePreferencePenalty(chrom, cands, prefs)).toBe(1);
  });
});

describe('calculateLoadPenalty — SKS over cap', () => {
  it('returns 0 when every lecturer is under cap', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
      flex(2, [{ roomId: 11, timeSlotIds: [4, 5, 6] }], [100]),
    ];
    const cands = [candidate(1, [100], 3), candidate(2, [100], 3)];
    // 100 assigned 6 SKS; cap 12 → no penalty.
    const maxSks = new Map<number, number>([[100, 12]]);
    expect(calculateLoadPenalty(chrom, cands, maxSks)).toBe(0);
  });

  it('returns N for a single lecturer over cap by N', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
      flex(2, [{ roomId: 11, timeSlotIds: [4, 5, 6] }], [100]),
      flex(3, [{ roomId: 12, timeSlotIds: [7, 8, 9] }], [100]),
      flex(4, [{ roomId: 13, timeSlotIds: [10, 11, 12] }], [100]),
      flex(5, [{ roomId: 14, timeSlotIds: [13, 14, 15] }], [100]),
    ];
    // 5 × 3-SKS offerings → 15 SKS assigned; cap 12 → over by 3.
    const cands = [
      candidate(1, [100], 3),
      candidate(2, [100], 3),
      candidate(3, [100], 3),
      candidate(4, [100], 3),
      candidate(5, [100], 3),
    ];
    const maxSks = new Map<number, number>([[100, 12]]);
    expect(calculateLoadPenalty(chrom, cands, maxSks)).toBe(3);
  });

  it('sums contributions across multiple over-cap lecturers', () => {
    // Lecturer 100: 4 SKS, cap 2 → over by 2.
    // Lecturer 200: 3 SKS, cap 0 → over by 3.
    // (Per-session credit equals candidate.sessionDuration here since each
    // gene has one session with timeSlotIds.length === sessionDuration.)
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3, 4] }], [100]),
      flex(2, [{ roomId: 11, timeSlotIds: [2, 3, 4] }], [200]),
    ];
    const cands = [candidate(1, [100], 4), candidate(2, [200], 3)];
    const maxSks = new Map<number, number>([[100, 2], [200, 0]]);
    expect(calculateLoadPenalty(chrom, cands, maxSks)).toBe(5);
  });

  it('charges full SKS for a lecturer with maxSks: 0 (on leave)', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100]),
    ];
    const cands = [candidate(1, [100], 3)];
    const maxSks = new Map<number, number>([[100, 0]]);
    expect(calculateLoadPenalty(chrom, cands, maxSks)).toBe(3);
  });

  it('credits full course SKS to each lecturer on a team-taught offering', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [1, 2, 3] }], [100, 200]),
    ];
    // 3-SKS offering, two lecturers, both maxSks 0 → each over by 3, total 6.
    const cands = [candidate(1, [100, 200], 3)];
    const maxSks = new Map<number, number>([[100, 0], [200, 0]]);
    expect(calculateLoadPenalty(chrom, cands, maxSks)).toBe(6);
  });
});

describe('calculateCapacityShortfallPenalty — null-room overflow (Phase 11 task #20)', () => {
  function room(id: number, capacity: number): Room {
    return { id, name: `R-${id}`, capacity, facilities: [] };
  }

  function nullRoomCandidate(
    offeringId: number,
    effectiveStudentCount: number,
    possibleRoomIds: number[],
  ): PreGACandidate {
    return {
      offeringId,
      courseId: offeringId * 10,
      roomId: null,
      lecturerIds: [100],
      effectiveStudentCount,
      parallelSessionCount: possibleRoomIds.length,
      sessionDuration: 1,
      possibleTimeSlotIds: [],
      possibleRoomIds,
      isFixedRoom: false,
    };
  }

  it('returns shortfall when cohort exceeds Σ session.room.capacity', () => {
    // 3 sessions, all cap 30 → combined = 90; cohort = 100 → shortfall = 10.
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1] },
        { roomId: 11, timeSlotIds: [2] },
        { roomId: 12, timeSlotIds: [3] },
      ]),
    ];
    const cands = [nullRoomCandidate(1, 100, [10, 11, 12])];
    const rooms = new Map<number, Room>([
      [10, room(10, 30)],
      [11, room(11, 30)],
      [12, room(12, 30)],
    ]);
    expect(calculateCapacityShortfallPenalty(chrom, cands, rooms)).toBe(10);
  });

  it('returns 0 when Σ session.room.capacity meets the cohort exactly', () => {
    // 3 sessions, all cap 30 → combined = 90; cohort = 90 → no shortfall.
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1] },
        { roomId: 11, timeSlotIds: [2] },
        { roomId: 12, timeSlotIds: [3] },
      ]),
    ];
    const cands = [nullRoomCandidate(1, 90, [10, 11, 12])];
    const rooms = new Map<number, Room>([
      [10, room(10, 30)],
      [11, room(11, 30)],
      [12, room(12, 30)],
    ]);
    expect(calculateCapacityShortfallPenalty(chrom, cands, rooms)).toBe(0);
  });

  it('returns 0 for pre-assigned-room offerings regardless of cohort (OQ-16)', () => {
    // candidate.roomId !== null → exempt from shortfall calc per OQ-16
    // (pre-assigned-room offerings split across timeslots, not rooms; their
    // capacity is already guaranteed by the validator's strict filter).
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1] },
        { roomId: 10, timeSlotIds: [2] },
      ]),
    ];
    // Pre-assigned room candidate: roomId is set, parallelSessionCount=2 via
    // ⌈students/room.capacity⌉. effectiveStudentCount=200 (intentionally huge)
    // → would be a shortfall under the null-room formula, but the OQ-16
    // exemption keeps the penalty at 0.
    const preAssignedCand: PreGACandidate = {
      offeringId: 1,
      courseId: 10,
      roomId: 10,
      lecturerIds: [100],
      effectiveStudentCount: 200,
      parallelSessionCount: 2,
      sessionDuration: 1,
      possibleTimeSlotIds: [],
      isFixedRoom: true,
    };
    const rooms = new Map<number, Room>([[10, room(10, 30)]]);
    expect(calculateCapacityShortfallPenalty(chrom, [preAssignedCand], rooms)).toBe(0);
  });
});

describe('calculateLecturerDistributionEntropy — Phase 15 #10 telemetry', () => {
  function cohortCandidate(offeringId: number): PreGACandidate {
    return {
      offeringId,
      courseId: offeringId * 10,
      roomId: null,
      lecturerIds: [100],
      effectiveStudentCount: 97,
      parallelSessionCount: 4,
      sessionDuration: 1,
      possibleTimeSlotIds: [1, 2, 3, 4],
      possibleRoomIds: [10, 11],
      isFixedRoom: false,
      siblingOfferingIds: [offeringId, offeringId + 1],
      lecturerPool: [100, 200],
      siblingLecturerGroups: [[100], [200]],
    };
  }

  it('returns 0 when no multi-offering cohorts are present', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [2], lecturerIds: [200] },
      ]),
    ];
    const cands = [candidate(1, [100], 1)];

    expect(calculateLecturerDistributionEntropy(chrom, cands)).toBe(0);
  });

  it('is 1 bit for a perfectly split two-lecturer cohort', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [2], lecturerIds: [200] },
        { roomId: 10, timeSlotIds: [3], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [4], lecturerIds: [200] },
      ]),
    ];

    expect(calculateLecturerDistributionEntropy(chrom, [cohortCandidate(1)])).toBe(1);
  });

  it('is 0 when one lecturer owns every multi-sibling cohort session', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [2], lecturerIds: [100] },
        { roomId: 10, timeSlotIds: [3], lecturerIds: [100] },
      ]),
    ];

    expect(calculateLecturerDistributionEntropy(chrom, [cohortCandidate(1)])).toBe(0);
  });

  it('does not change softPenalty or fitness when only the lecturer distribution changes', () => {
    const cands = [cohortCandidate(1)];
    const structural = new Map<number, boolean>();
    const prefs = new Map<number, Set<number>>();
    const maxSks = new Map<number, number>();
    const balanced = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [2], lecturerIds: [200] },
      ]),
    ];
    const concentrated = [
      flex(1, [
        { roomId: 10, timeSlotIds: [1], lecturerIds: [100] },
        { roomId: 11, timeSlotIds: [2], lecturerIds: [100] },
      ]),
    ];

    const balancedFitness = evaluateFitness(balanced, cands, structural, prefs, maxSks);
    const concentratedFitness = evaluateFitness(concentrated, cands, structural, prefs, maxSks);

    expect(balancedFitness.lecturerDistributionEntropy).toBe(1);
    expect(concentratedFitness.lecturerDistributionEntropy).toBe(0);
    expect(balancedFitness.softPenalty).toBe(concentratedFitness.softPenalty);
    expect(balancedFitness.fitness).toBe(concentratedFitness.fitness);
  });
});
