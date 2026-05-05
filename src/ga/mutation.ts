/**
 * GA — Masked Mutation (ADR-01: Partial Gene Masking)
 *
 * FIXED genes: only sessions[].timeSlotIds may change — sessions[].roomId is immutable.
 * FLEXIBLE genes: both sessions[].roomId (when possibleRoomIds available) and
 *   sessions[].timeSlotIds may change.
 */

import type { Chromosome, Gene, GeneSession, PreGACandidate } from '../types.js';
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

    const { parallelSessionCount, sessionDuration } = candidate;
    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);

    if (gene.kind === 'FIXED') {
      // MASKED: sessions[].roomId is structurally immutable for Fixed Room genes.
      // Rebuild sessions with the same roomId but new (shuffled) timeSlotIds.
      const newSessions: GeneSession[] = gene.sessions.map((session, i) => ({
        roomId: session.roomId, // immutable — original room kept
        timeSlotIds: shuffledSlots.slice(i * sessionDuration, (i + 1) * sessionDuration),
      }));
      return {
        ...gene,
        sessions: newSessions,
      };
    }

    // FLEXIBLE: both roomId and timeSlots are mutable.
    const newRoomId = candidate.possibleRoomIds?.length
      ? candidate.possibleRoomIds[
          Math.floor(Math.random() * candidate.possibleRoomIds.length)
        ]!
      : gene.sessions[0]?.roomId ?? candidate.roomId;

    const newSessions: GeneSession[] = Array.from({ length: parallelSessionCount }, (_, i) => ({
      roomId: newRoomId,
      timeSlotIds: shuffledSlots.slice(i * sessionDuration, (i + 1) * sessionDuration),
    }));

    return {
      ...gene,
      sessions: newSessions,
    };
  });
}
