/**
 * GA — Conflict-Aware Repair (ADR-02)
 * 
 * Greedy local search that resolves hard constraint violations
 * after crossover + mutation. Iterates through genes and
 * reassigns conflicting slots.
 */

import type { Chromosome, Gene, PreGACandidate } from '../types.js';
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

    for (const slotId of gene.assignedTimeSlotIds) {
      // Use gene.roomId (FLEXIBLE genes may have a different room after mutation)
      roomTimeUsed.set(`room:${gene.roomId}:slot:${slotId}`, gene.offeringId);
      for (const lecturerId of candidate.lecturerIds) {
        lecturerTimeUsed.set(`lec:${lecturerId}:slot:${slotId}`, gene.offeringId);
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

export function repairChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[]
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));
  const repaired = chromosome.map(g => ({ ...g, assignedTimeSlotIds: [...g.assignedTimeSlotIds] }) as Gene);

  for (const gene of repaired) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;
    if (gene.kind === 'FIXED') continue; // FIXED genes are never repaired (masking invariant)

    const roomId = gene.roomId;

    // Build conflict index excluding this gene
    const index = buildConflictIndex(repaired, candidates, gene.offeringId);

    // Check each assigned slot for conflicts
    const newSlots: number[] = [];
    const usedSlots = new Set<number>();

    for (const slotId of gene.assignedTimeSlotIds) {
      if (!hasConflict(slotId, roomId, candidate, index) && !usedSlots.has(slotId)) {
        newSlots.push(slotId);
        usedSlots.add(slotId);
      }
    }

    // Fill remaining slots with non-conflicting alternatives
    if (newSlots.length < candidate.parallelSessionCount) {
      const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
      for (const slotId of shuffledSlots) {
        if (newSlots.length >= candidate.parallelSessionCount) break;
        if (usedSlots.has(slotId)) continue;
        if (!hasConflict(slotId, roomId, candidate, index)) {
          newSlots.push(slotId);
          usedSlots.add(slotId);
        }
      }
    }

    // If still not enough, fill with any available (greedy fallback)
    if (newSlots.length < candidate.parallelSessionCount) {
      const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
      for (const slotId of shuffledSlots) {
        if (newSlots.length >= candidate.parallelSessionCount) break;
        if (usedSlots.has(slotId)) continue;
        newSlots.push(slotId);
        usedSlots.add(slotId);
      }
    }

    gene.assignedTimeSlotIds = newSlots;
  }

  return repaired;
}
