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
 */
export function createGeneFromCandidate(
  candidate: PreGACandidate,
  shuffledSlots: number[]
): Gene {
  const assignedTimeSlotIds = shuffledSlots.slice(0, candidate.requiredSessions);

  if (candidate.isFixedRoom) {
    return {
      kind: 'FIXED',
      offeringId: candidate.offeringId,
      roomId: candidate.roomId,
      assignedTimeSlotIds,
    };
  }

  return {
    kind: 'FLEXIBLE',
    offeringId: candidate.offeringId,
    roomId: candidate.roomId,
    assignedTimeSlotIds,
  };
}

/**
 * Create a single random chromosome.
 * Each gene assigns `requiredSessions` time slots to an offering.
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
