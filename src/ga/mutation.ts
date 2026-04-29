/**
 * GA — Masked Mutation (ADR-01: Partial Gene Masking)
 *
 * FIXED genes: only assignedTimeSlotIds may change — roomId is structurally immutable.
 * FLEXIBLE genes: both roomId (when possibleRoomIds available) and timeSlots may change.
 */

import type { Chromosome, Gene, PreGACandidate } from '../types.js';
import { fisherYatesShuffle } from './chromosome.js';

export function mutateChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  mutationRate: number
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  return chromosome.map((gene): Gene => {
    if (Math.random() >= mutationRate) return gene;

    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) return gene;

    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    const newSlots = shuffledSlots.slice(0, candidate.requiredSessions);

    if (gene.kind === 'FIXED') {
      // MASKED: roomId is structurally immutable for Fixed Room genes.
      // TypeScript enforces this — only assignedTimeSlotIds is updated.
      return {
        ...gene,
        assignedTimeSlotIds: newSlots,
      };
    }

    // FLEXIBLE: both roomId and timeSlot are mutable.
    const newRoomId = candidate.possibleRoomIds?.length
      ? candidate.possibleRoomIds[
          Math.floor(Math.random() * candidate.possibleRoomIds.length)
        ]!
      : gene.roomId;

    return {
      ...gene,
      roomId: newRoomId,
      assignedTimeSlotIds: newSlots,
    };
  });
}
