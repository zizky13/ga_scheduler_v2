/**
 * GA — Conflict-Aware Repair (ADR-02)
 *
 * Resolves hard constraint violations after crossover + mutation.
 *
 * Task 23 (SKS Blocks): Repair operates per *contiguous block*, not per slot.
 *   When a SlotLookup is supplied, a conflicting session is replaced wholesale
 *   with a different contiguous block drawn from `findContiguousSlots`. This
 *   preserves the back-to-back same-day invariant required by sessionDuration.
 *   For FLEXIBLE genes we additionally try alternate rooms from
 *   `possibleRoomIds` before falling back to a still-contiguous (but possibly
 *   conflicting) block, which the GA will penalise via fitness.
 *
 *   Without a SlotLookup we fall back to the legacy per-slot greedy repair
 *   (used by older tests / call sites that have no slot metadata).
 */

import type { Chromosome, Gene, GeneSession, PreGACandidate } from '../types.js';
import {
  fisherYatesShuffle,
  findContiguousSlots,
  type SlotLookup,
} from './chromosome.js';

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

function slotConflicts(
  slotId: number,
  roomId: number,
  candidate: PreGACandidate,
  index: ConflictIndex
): boolean {
  if (index.roomTimeUsed.has(`room:${roomId}:slot:${slotId}`)) return true;
  for (const lecturerId of candidate.lecturerIds) {
    if (index.lecturerTimeUsed.has(`lec:${lecturerId}:slot:${slotId}`)) return true;
  }
  return false;
}

function blockConflicts(
  block: number[],
  roomId: number,
  candidate: PreGACandidate,
  index: ConflictIndex,
  usedSlotsInGene: Set<number>
): boolean {
  for (const slotId of block) {
    if (usedSlotsInGene.has(slotId)) return true;
    if (slotConflicts(slotId, roomId, candidate, index)) return true;
  }
  return false;
}

/**
 * Full contiguous-block repair: if the session has any conflict, replace the
 * entire block with a non-conflicting contiguous block. Falls back through:
 *   1. A clean block on the same room.
 *   2. (FLEXIBLE only) a clean block on any allowed room.
 *   3. Any contiguous block on the same room (residual conflict accepted).
 *   4. The original session (no contiguous blocks exist at all).
 */
function repairSessionAsBlock(
  session: GeneSession,
  candidate: PreGACandidate,
  geneKind: Gene['kind'],
  index: ConflictIndex,
  lookup: SlotLookup,
  usedSlotsInGene: Set<number>
): GeneSession {
  const { sessionDuration } = candidate;

  // Fast path: current block is contiguous and conflict-free → keep it.
  const currentClean = !session.timeSlotIds.some(
    s => usedSlotsInGene.has(s) || slotConflicts(s, session.roomId, candidate, index)
  );
  if (currentClean && session.timeSlotIds.length === sessionDuration) {
    return session;
  }

  const blocks = findContiguousSlots(candidate.possibleTimeSlotIds, sessionDuration, lookup);
  if (blocks.length === 0) {
    return session; // degenerate dataset — nothing better to offer
  }

  const shuffledBlocks = fisherYatesShuffle(blocks);

  // 1. Try a clean block on the current room.
  for (const block of shuffledBlocks) {
    if (!blockConflicts(block, session.roomId, candidate, index, usedSlotsInGene)) {
      return { roomId: session.roomId, timeSlotIds: block };
    }
  }

  // 2. FLEXIBLE: try a clean block on any other allowed room.
  if (geneKind === 'FLEXIBLE' && candidate.possibleRoomIds?.length) {
    const shuffledRooms = fisherYatesShuffle(candidate.possibleRoomIds);
    for (const altRoom of shuffledRooms) {
      if (altRoom === session.roomId) continue;
      for (const block of shuffledBlocks) {
        if (!blockConflicts(block, altRoom, candidate, index, usedSlotsInGene)) {
          return { roomId: altRoom, timeSlotIds: block };
        }
      }
    }
  }

  // 3. No clean placement found. Pick any contiguous block on the current room.
  // GA fitness will penalise the residual collision; contiguity is preserved.
  return { roomId: session.roomId, timeSlotIds: shuffledBlocks[0]! };
}

/**
 * Legacy per-slot greedy repair (pre-Task-23). Used when no SlotLookup is
 * supplied — preserves the previous behaviour for callers that lack slot
 * metadata. Does not guarantee contiguity.
 */
function repairSessionGreedy(
  session: GeneSession,
  needed: number,
  candidate: PreGACandidate,
  index: ConflictIndex
): GeneSession {
  const { roomId } = session;
  const newSlots: number[] = [];
  const usedSlots = new Set<number>();

  for (const slotId of session.timeSlotIds) {
    if (!slotConflicts(slotId, roomId, candidate, index) && !usedSlots.has(slotId)) {
      newSlots.push(slotId);
      usedSlots.add(slotId);
    }
  }

  if (newSlots.length < needed) {
    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    for (const slotId of shuffledSlots) {
      if (newSlots.length >= needed) break;
      if (usedSlots.has(slotId)) continue;
      if (!slotConflicts(slotId, roomId, candidate, index)) {
        newSlots.push(slotId);
        usedSlots.add(slotId);
      }
    }
  }

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
  candidates: PreGACandidate[],
  lookup?: SlotLookup
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  const repaired: Gene[] = chromosome.map(g => ({
    ...g,
    sessions: g.sessions.map(s => ({ roomId: s.roomId, timeSlotIds: [...s.timeSlotIds] })),
  }));

  for (const gene of repaired) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    const index = buildConflictIndex(repaired, candidates, gene.offeringId);

    if (lookup) {
      // Full contiguous-block repair (Task 23).
      // Track slots already taken by sibling sessions of *this* gene so that
      // parallel sessions never overlap their own block.
      const usedSlotsInGene = new Set<number>();
      const newSessions: GeneSession[] = [];
      for (const session of gene.sessions) {
        const repairedSession =
          gene.kind === 'FIXED'
            ? repairSessionAsBlock(
                { roomId: session.roomId, timeSlotIds: session.timeSlotIds },
                candidate,
                'FIXED',
                index,
                lookup,
                usedSlotsInGene
              )
            : repairSessionAsBlock(
                session,
                candidate,
                'FLEXIBLE',
                index,
                lookup,
                usedSlotsInGene
              );
        for (const sid of repairedSession.timeSlotIds) usedSlotsInGene.add(sid);
        newSessions.push(repairedSession);
      }
      // FIXED genes must keep the original roomId on every session (masking).
      if (gene.kind === 'FIXED') {
        const originalRoom = gene.sessions[0]?.roomId;
        if (originalRoom !== undefined) {
          for (const s of newSessions) s.roomId = originalRoom;
        }
      }
      gene.sessions = newSessions;
    } else {
      // Legacy per-slot greedy repair.
      if (gene.kind === 'FIXED') continue;
      gene.sessions = gene.sessions.map(session =>
        repairSessionGreedy(session, candidate.sessionDuration, candidate, index)
      );
    }
  }

  return repaired;
}
