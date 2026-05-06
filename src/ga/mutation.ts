/**
 * GA — Masked Mutation (ADR-01: Partial Gene Masking)
 *
 * FIXED genes: only sessions[].timeSlotIds may change — sessions[].roomId is immutable.
 * FLEXIBLE genes: both sessions[].roomId (when possibleRoomIds available) and
 *   sessions[].timeSlotIds may change.
 *
 * Task 18: When a SlotLookup is supplied, mutated timeSlotIds are drawn from
 * valid contiguous blocks via findContiguousSlots. Falls back to shuffle-and-
 * slice when no contiguous blocks are available.
 */

import type { Chromosome, Gene, GeneSession, PreGACandidate } from '../types.js';
import {
  fisherYatesShuffle,
  findContiguousSlots,
  type SlotLookup,
} from './chromosome.js';

/**
 * Pick `count` contiguous blocks from the available blocks, allowing
 * duplicates when fewer blocks than `count` exist.
 */
function pickBlocks(blocks: number[][], count: number): number[][] {
  if (blocks.length === 0) return [];
  const shuffled = fisherYatesShuffle(blocks);
  return Array.from({ length: count }, (_, i) => shuffled[i % shuffled.length]!);
}

/**
 * Fallback: build sessions with a plain shuffle-and-slice (pre-Task-18 logic).
 */
function buildSessionsFallback(
  candidate: PreGACandidate,
  roomId: number,
  count: number
): GeneSession[] {
  const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
  return Array.from({ length: count }, (_, i) => ({
    roomId,
    timeSlotIds: shuffledSlots.slice(
      i * candidate.sessionDuration,
      (i + 1) * candidate.sessionDuration
    ),
  }));
}

export function mutateChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  mutationRate: number,
  lookup?: SlotLookup
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  return chromosome.map((gene): Gene => {
    if (Math.random() >= mutationRate) return gene;

    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) return gene;

    const { parallelSessionCount, sessionDuration } = candidate;

    // Compute contiguous blocks once per mutation (when lookup available)
    let blocks: number[][] | null = null;
    if (lookup) {
      blocks = findContiguousSlots(candidate.possibleTimeSlotIds, sessionDuration, lookup);
    }

    if (gene.kind === 'FIXED') {
      // MASKED: sessions[].roomId is structurally immutable for Fixed Room genes.
      // Rebuild sessions with the same roomId but new contiguous timeSlotIds.
      let newSessions: GeneSession[];

      if (blocks && blocks.length > 0) {
        const picked = pickBlocks(blocks, gene.sessions.length);
        newSessions = gene.sessions.map((session, i) => ({
          roomId: session.roomId, // immutable — original room kept
          timeSlotIds: picked[i]!,
        }));
      } else {
        // Fallback: shuffle-and-slice (preserving room)
        const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
        newSessions = gene.sessions.map((session, i) => ({
          roomId: session.roomId,
          timeSlotIds: shuffledSlots.slice(i * sessionDuration, (i + 1) * sessionDuration),
        }));
      }

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

    let newSessions: GeneSession[];

    if (blocks && blocks.length > 0) {
      const picked = pickBlocks(blocks, parallelSessionCount);
      newSessions = picked.map(block => ({
        roomId: newRoomId,
        timeSlotIds: block,
      }));
    } else {
      newSessions = buildSessionsFallback(candidate, newRoomId, parallelSessionCount);
    }

    return {
      ...gene,
      sessions: newSessions,
    };
  });
}
