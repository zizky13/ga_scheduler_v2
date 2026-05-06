/**
 * evaluateHardFitness — nested sessions[] collision counting (Task 20).
 *
 * Verifies room/lecturer collision counts for the new
 * gene.sessions[]{roomId, timeSlotIds} shape, including:
 *   - cross-gene room collisions
 *   - cross-gene lecturer collisions
 *   - intra-gene parallel-session collisions
 *   - multi-slot contiguous-block overlaps
 */

import { describe, it, expect } from 'vitest';
import { evaluateHardFitness } from '../../src/ga/fitness.js';
import type { Chromosome, FlexibleGene, PreGACandidate } from '../../src/types.js';

function flex(offeringId: number, sessions: { roomId: number; timeSlotIds: number[] }[]): FlexibleGene {
  return { kind: 'FLEXIBLE', offeringId, sessions };
}

function candidate(offeringId: number, lecturerIds: number[]): PreGACandidate {
  return {
    offeringId,
    courseId: offeringId * 10,
    roomId: 1,
    lecturerIds,
    parallelSessionCount: 1,
    sessionDuration: 1,
    possibleTimeSlotIds: [],
    isFixedRoom: false,
  };
}

describe('evaluateHardFitness — nested sessions', () => {
  it('returns 0 when no collisions exist', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }]),
      flex(2, [{ roomId: 11, timeSlotIds: [6] }]),
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(0);
  });

  it('counts cross-gene room collision at the same slot', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }]),
      flex(2, [{ roomId: 10, timeSlotIds: [5] }]), // same room, same slot
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(1);
  });

  it('counts cross-gene lecturer collision at the same slot', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }]),
      flex(2, [{ roomId: 11, timeSlotIds: [5] }]),
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
      ]),
    ];
    const cands = [candidate(1, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(1);
  });

  it('does NOT count lecturer collision for parallel sessions at different slots', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [5] },
        { roomId: 11, timeSlotIds: [6] },
      ]),
    ];
    const cands = [candidate(1, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(0);
  });

  it('counts intra-gene room collision when parallel sessions share a room', () => {
    const chrom: Chromosome = [
      flex(1, [
        { roomId: 10, timeSlotIds: [5] },
        { roomId: 10, timeSlotIds: [5] }, // same room and slot — illegal
      ]),
    ];
    const cands = [candidate(1, [100])];
    // Both room and lecturer collide → 2 violations
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts each overlapping slot in multi-slot contiguous blocks', () => {
    // Two genes: contiguous 3-slot blocks share room at slots 5 and 6.
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5, 6, 7] }]),
      flex(2, [{ roomId: 10, timeSlotIds: [4, 5, 6] }]),
    ];
    const cands = [candidate(1, [100]), candidate(2, [101])];
    // Slots 5 and 6 overlap → 2 room violations
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts both room and lecturer violations independently', () => {
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }]),
      flex(2, [{ roomId: 10, timeSlotIds: [5] }]), // shared room AND shared lecturer
    ];
    const cands = [candidate(1, [100]), candidate(2, [100])];
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });

  it('counts team-teaching lecturer collisions per lecturer', () => {
    // gene 1 lectured by [100, 101]; gene 2 lectured by [100, 101] at same slot.
    // Both lecturers collide → 2 lecturer violations.
    const chrom: Chromosome = [
      flex(1, [{ roomId: 10, timeSlotIds: [5] }]),
      flex(2, [{ roomId: 11, timeSlotIds: [5] }]),
    ];
    const cands = [candidate(1, [100, 101]), candidate(2, [100, 101])];
    expect(evaluateHardFitness(chrom, cands)).toBe(2);
  });
});
