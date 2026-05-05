/**
 * GA — Chromosome Operations
 *
 * Fisher-Yates shuffle for unbiased randomization.
 * createGeneFromCandidate constructs a typed gene (FIXED | FLEXIBLE).
 * createRandomChromosome builds a single candidate timetable.
 */

import type { Chromosome, Gene, PreGACandidate } from '../types.js';

/** Unbiased Fisher-Yates shuffle — O(n) */
export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Create a typed gene from a candidate using pre-shuffled slot array.
 * isFixedRoom=true → FixedRoomGene (kind: 'FIXED'); roomId is immutable.
 * isFixedRoom=false → FlexibleGene (kind: 'FLEXIBLE'); roomId is mutable.
 *
 * Each gene carries `sessions[]` — one entry per parallel group.
 * Each session holds a `roomId` and `timeSlotIds` (length = sessionDuration).
 * NOTE: contiguous-slot enforcement is deferred to Task 17 (findContiguousSlots).
 *       For now slots are assigned sequentially from the shuffled pool.
 */
export function createGeneFromCandidate(
  candidate: PreGACandidate,
  shuffledSlots: number[]
): Gene {
  const { parallelSessionCount, sessionDuration, roomId } = candidate;

  // Build one session per parallel group, each consuming sessionDuration slots
  // from the shuffled pool in order.
  const sessions = Array.from({ length: parallelSessionCount }, (_, i) => ({
    roomId,
    timeSlotIds: shuffledSlots.slice(i * sessionDuration, (i + 1) * sessionDuration),
  }));

  if (candidate.isFixedRoom) {
    return {
      kind: 'FIXED',
      offeringId: candidate.offeringId,
      sessions,
    };
  }

  return {
    kind: 'FLEXIBLE',
    offeringId: candidate.offeringId,
    sessions,
  };
}

/**
 * Create a single random chromosome.
 * Each gene assigns `parallelSessionCount` time slots to an offering.
 */
export function createRandomChromosome(
  candidates: PreGACandidate[],
  noiseRate: number = 0.15
): Chromosome {
  return candidates.map(candidate => {
    let shuffled = fisherYatesShuffle(candidate.possibleTimeSlotIds);

    // Apply noise: with noiseRate probability, shuffle again for diversity
    if (Math.random() < noiseRate) {
      shuffled = fisherYatesShuffle(shuffled);
    }

    return createGeneFromCandidate(candidate, shuffled);
  });
}
