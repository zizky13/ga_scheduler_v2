/**
 * GA — Conflict-Aware Repair (ADR-02)
 * 
 * Greedy local search that resolves hard constraint violations
 * after crossover + mutation. Iterates through genes and
 * reassigns conflicting slots.
 *
 * NOTE (Task 16): Gene shape changed to sessions[]{roomId, timeSlotIds}.
 *   Repair operates per-session: for each parallel session we check its
 *   (roomId, slotId) pairs and greedily re-assign conflicting ones.
 *   Full contiguous-block repair is deferred to Task 18.
 */

import type { Chromosome, Gene, GeneSession, PreGACandidate } from '../types.js';
import { fisherYatesShuffle } from './chromosome.js';

interface ConflictIndex {
  roomTimeUsed: Map<string, number>;    // "room:X:slot:Y" → offeringId
  lecturerTimeUsed: Map<string, number>; // "lec:X:slot:Y" → offeringId
}

function buildConflictIndex(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  excludeOfferingId?: number
): ConflictIndex {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  const roomTimeUsed = new Map<string, number>();
  const lecturerTimeUsed = new Map<string, number>();

  for (const gene of chromosome) {
    if (gene.offeringId === excludeOfferingId) continue;
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    for (const session of gene.sessions) {
      for (const slotId of session.timeSlotIds) {
        roomTimeUsed.set(`room:${session.roomId}:slot:${slotId}`, gene.offeringId);
        for (const lecturerId of candidate.lecturerIds) {
          lecturerTimeUsed.set(`lec:${lecturerId}:slot:${slotId}`, gene.offeringId);
        }
      }
    }
  }

  return { roomTimeUsed, lecturerTimeUsed };
}

function hasConflict(
  slotId: number,
  roomId: number,
  candidate: PreGACandidate,
  index: ConflictIndex
): boolean {
  if (index.roomTimeUsed.has(`room:${roomId}:slot:${slotId}`)) {
    return true;
  }
  for (const lecturerId of candidate.lecturerIds) {
    if (index.lecturerTimeUsed.has(`lec:${lecturerId}:slot:${slotId}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Repair a single session's timeSlotIds by removing conflicting slots and
 * filling vacancies from the shuffled available slot pool.
 */
function repairSession(
  session: GeneSession,
  needed: number,
  candidate: PreGACandidate,
  index: ConflictIndex
): GeneSession {
  const { roomId } = session;
  const newSlots: number[] = [];
  const usedSlots = new Set<number>();

  // Keep non-conflicting slots first
  for (const slotId of session.timeSlotIds) {
    if (!hasConflict(slotId, roomId, candidate, index) && !usedSlots.has(slotId)) {
      newSlots.push(slotId);
      usedSlots.add(slotId);
    }
  }

  // Fill remaining with non-conflicting alternatives
  if (newSlots.length < needed) {
    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    for (const slotId of shuffledSlots) {
      if (newSlots.length >= needed) break;
      if (usedSlots.has(slotId)) continue;
      if (!hasConflict(slotId, roomId, candidate, index)) {
        newSlots.push(slotId);
        usedSlots.add(slotId);
      }
    }
  }

  // Greedy fallback — any remaining slot (no conflict guarantee)
  if (newSlots.length < needed) {
    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    for (const slotId of shuffledSlots) {
      if (newSlots.length >= needed) break;
      if (usedSlots.has(slotId)) continue;
      newSlots.push(slotId);
      usedSlots.add(slotId);
    }
  }

  return { roomId, timeSlotIds: newSlots };
}

export function repairChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[]
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  // Deep-clone sessions to avoid mutating the original chromosome
  const repaired: Gene[] = chromosome.map(g => ({
    ...g,
    sessions: g.sessions.map(s => ({ roomId: s.roomId, timeSlotIds: [...s.timeSlotIds] })),
  }));

  for (const gene of repaired) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    if (gene.kind === 'FIXED') continue; // FIXED genes are never repaired (masking invariant)

    // Build conflict index excluding this gene
    const index = buildConflictIndex(repaired, candidates, gene.offeringId);

    gene.sessions = gene.sessions.map(session =>
      repairSession(session, candidate.sessionDuration, candidate, index)
    );
  }

  return repaired;
}
