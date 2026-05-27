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
import type { Chromosome, FixedRoomGene, FlexibleGene, Gene } from '../../src/types.js';

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
  const fixed = (offeringId: number, roomId: number, slots: number[]): FixedRoomGene => ({
    kind: 'FIXED',
    offeringId,
    sessions: [{ roomId, timeSlotIds: slots, lecturerIds: [] }],
  });
  const flexible = (offeringId: number, roomId: number, slots: number[]): FlexibleGene => ({
    kind: 'FLEXIBLE',
    offeringId,
    sessions: [{ roomId, timeSlotIds: slots, lecturerIds: [] }],
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
        const [child1, child2] = op.fn(parent1, parent2);
        expect(() => assertMaskingInvariant(parent1, child1)).not.toThrow();
        expect(() => assertMaskingInvariant(parent2, child2)).not.toThrow();
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
  });
}
