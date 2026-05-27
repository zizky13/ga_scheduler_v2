/**
 * Crossover operator unit tests (techspec §10.1).
 *
 * For each operator (singlePoint, uniform, pmx) we verify:
 *   1. assertMaskingInvariant(parent, child) holds across many iterations.
 *   2. The multiset of offeringIds in each child equals the parents' multiset
 *      (crossover only swaps gene contents at matching loci).
 *   3. Every FIXED locus in either parent stays FIXED in the child with the
 *      same roomId — the masking invariant from techspec §6.3 / FR-03.
 */

import { describe, it, expect } from 'vitest';
import {
  assertMaskingInvariant,
  singlePointCrossover,
  uniformCrossover,
  pmxCrossover,
} from '../../src/ga/crossover.js';
import type {
  Chromosome,
  FixedRoomGene,
  FlexibleGene,
  Gene,
  PreGACandidate,
} from '../../src/types.js';

// ─── Fixture helpers ──────────────────────────────────────────────

/**
 * Build a 6-gene chromosome with deterministic ids.
 * Layout (locus → kind, offeringId, roomId):
 *   0 → FIXED,    101, 1
 *   1 → FLEXIBLE, 102, 2
 *   2 → FLEXIBLE, 103, 3
 *   3 → FIXED,    104, 4
 *   4 → FLEXIBLE, 105, 5
 *   5 → FLEXIBLE, 106, 6
 */
function buildParent(slotOffset: number): Chromosome {
  const lecturerBase = (offeringId: number): number =>
    offeringId * 10 + (slotOffset === 0 ? 0 : 1000);
  const sessions = (offeringId: number, roomId: number, slots: number[]) => {
    const base = lecturerBase(offeringId);
    return [
      { roomId, timeSlotIds: slots, lecturerIds: [base] },
      { roomId, timeSlotIds: slots.map(id => id + 1), lecturerIds: [base + 1] },
    ];
  };
  const fixed = (offeringId: number, roomId: number, slots: number[]): FixedRoomGene => ({
    kind: 'FIXED',
    offeringId,
    sessions: sessions(offeringId, roomId, slots),
  });
  const flexible = (offeringId: number, roomId: number, slots: number[]): FlexibleGene => ({
    kind: 'FLEXIBLE',
    offeringId,
    sessions: sessions(offeringId, roomId, slots),
  });
  return [
    fixed(101, 1, [10 + slotOffset, 11 + slotOffset]),
    flexible(102, 2, [20 + slotOffset, 21 + slotOffset]),
    flexible(103, 3, [30 + slotOffset]),
    fixed(104, 4, [40 + slotOffset, 41 + slotOffset]),
    flexible(105, 5, [50 + slotOffset]),
    flexible(106, 6, [60 + slotOffset, 61 + slotOffset]),
  ];
}

function buildCandidateMasks(): PreGACandidate[] {
  return [101, 102, 103, 104, 105, 106].map((offeringId) => {
    const lecturerPool = [
      offeringId * 10,
      offeringId * 10 + 1,
      offeringId * 10 + 1000,
      offeringId * 10 + 1001,
    ];
    return {
      offeringId,
      courseId: offeringId,
      roomId: null,
      lecturerIds: [offeringId * 10],
      effectiveStudentCount: 30,
      parallelSessionCount: 2,
      sessionDuration: 1,
      possibleTimeSlotIds: [1, 2, 3, 4],
      possibleRoomIds: [1, 2, 3, 4, 5, 6],
      isFixedRoom: offeringId === 101 || offeringId === 104,
      fixedTimeSlotIds: offeringId === 101 || offeringId === 104 ? [1, 2] : undefined,
      parentOfferingId: undefined,
      siblingOfferingIds: [offeringId],
      lecturerPool,
      siblingLecturerGroups: [[offeringId * 10]],
    };
  });
}

function multiset(genes: Gene[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of genes) {
    m.set(g.offeringId, (m.get(g.offeringId) ?? 0) + 1);
  }
  return m;
}

function multisetsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

const ITERATIONS = 100;

const operators: Array<{
  name: string;
  fn: (p1: Chromosome, p2: Chromosome) => [Chromosome, Chromosome];
}> = [
  { name: 'singlePointCrossover', fn: singlePointCrossover },
  { name: 'uniformCrossover', fn: uniformCrossover },
  { name: 'pmxCrossover', fn: pmxCrossover },
];

for (const op of operators) {
  describe(op.name, () => {
    it('assertMaskingInvariant passes for all child genes', () => {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const parent1 = buildParent(0);
        const parent2 = buildParent(100);
        const candidates = buildCandidateMasks();
        const [child1, child2] = op.fn(parent1, parent2);
        expect(() => assertMaskingInvariant(parent1, child1, candidates)).not.toThrow();
        expect(() => assertMaskingInvariant(parent2, child2, candidates)).not.toThrow();
      }
    });

    it('Children contain no offeringIds not present in parents', () => {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const parent1 = buildParent(0);
        const parent2 = buildParent(100);
        const parentMultiset = multiset([...parent1, ...parent2]);
        const [child1, child2] = op.fn(parent1, parent2);
        const childMultiset = multiset([...child1, ...child2]);
        expect(multisetsEqual(parentMultiset, childMultiset)).toBe(true);
        // And per-child: each child's multiset equals each parent's multiset
        // (since both parents share the same offeringId layout).
        const p1Set = multiset(parent1);
        expect(multisetsEqual(p1Set, multiset(child1))).toBe(true);
        expect(multisetsEqual(p1Set, multiset(child2))).toBe(true);
      }
    });

    it("FixedRoomGene session roomIds equal parent's roomIds at same locus", () => {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const parent1 = buildParent(0);
        const parent2 = buildParent(100);
        const [child1, child2] = op.fn(parent1, parent2);
        for (let i = 0; i < parent1.length; i++) {
          const p1 = parent1[i]!;
          const p2 = parent2[i]!;
          const c1 = child1[i]!;
          const c2 = child2[i]!;
          if (p1.kind === 'FIXED') {
            expect(c1.kind).toBe('FIXED');
            // sessions[0].roomId must be preserved from the contributing parent
            expect((c1 as FixedRoomGene).sessions[0]!.roomId).toBe((p1 as FixedRoomGene).sessions[0]!.roomId);
            expect(c2.kind).toBe('FIXED');
            expect((c2 as FixedRoomGene).sessions[0]!.roomId).toBe((p2 as FixedRoomGene).sessions[0]!.roomId);
          }
        }
      }
    });

    it('per-session lecturerIds ride along with swapped sessions and stay within candidate lecturerPool', () => {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const parent1 = buildParent(0);
        const parent2 = buildParent(100);
        const candidates = buildCandidateMasks();
        const [child1, child2] = op.fn(parent1, parent2);

        for (const child of [child1, child2]) {
          for (let i = 0; i < child.length; i++) {
            const candidate = candidates.find(c => c.offeringId === child[i]!.offeringId)!;
            const pool = new Set(candidate.lecturerPool);
            for (const session of child[i]!.sessions) {
              for (const lecturerId of session.lecturerIds) {
                expect(pool.has(lecturerId)).toBe(true);
              }
            }
          }
        }

        expect(() => assertMaskingInvariant(parent1, child1, candidates)).not.toThrow();
        expect(() => assertMaskingInvariant(parent2, child2, candidates)).not.toThrow();
      }
    });
  });
}

describe('assertMaskingInvariant Phase 15 lecturer mask', () => {
  it('throws when a child session lecturerId is outside the candidate lecturerPool', () => {
    const parent = buildParent(0);
    const child = buildParent(0);
    child[1] = {
      ...child[1]!,
      sessions: child[1]!.sessions.map((session, index) => index === 0
        ? { ...session, lecturerIds: [999_999] }
        : session
      ),
    };

    expect(() => assertMaskingInvariant(parent, child, buildCandidateMasks()))
      .toThrow(/lecturerId 999999 is outside candidate 102 lecturerPool/);
  });
});
