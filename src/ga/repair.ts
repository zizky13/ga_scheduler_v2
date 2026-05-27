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

import type { Chromosome, Gene, GeneSession, PreGACandidate, Room } from '../types.js';
import {
  fisherYatesShuffle,
  findContiguousSlots,
  pickSameDaySessionSlots,
  type SlotLookup,
} from './chromosome.js';

interface ConflictIndex {
  roomTimeUsed: Map<string, number>;    // "room:X:slot:Y" → offeringId
  lecturerTimeUsed: Map<string, number>; // "lec:X:slot:Y" → offeringId
}

function buildConflictIndex(
  chromosome: Chromosome,
  excludeOfferingId?: number
): ConflictIndex {
  const roomTimeUsed = new Map<string, number>();
  const lecturerTimeUsed = new Map<string, number>();

  for (const gene of chromosome) {
    if (gene.offeringId === excludeOfferingId) continue;

    for (const session of gene.sessions) {
      for (const slotId of session.timeSlotIds) {
        roomTimeUsed.set(`room:${session.roomId}:slot:${slotId}`, gene.offeringId);
        for (const lecturerId of session.lecturerIds) {
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
  lecturerIds: number[],
  index: ConflictIndex
): boolean {
  if (index.roomTimeUsed.has(`room:${roomId}:slot:${slotId}`)) return true;
  for (const lecturerId of lecturerIds) {
    if (index.lecturerTimeUsed.has(`lec:${lecturerId}:slot:${slotId}`)) return true;
  }
  return false;
}

function roomOrGeneSlotConflicts(
  block: number[],
  roomId: number,
  index: ConflictIndex,
  usedSlotsInGene: Set<number>
): boolean {
  for (const slotId of block) {
    if (usedSlotsInGene.has(slotId)) return true;
    if (index.roomTimeUsed.has(`room:${roomId}:slot:${slotId}`)) return true;
  }
  return false;
}

function lecturerConflicts(
  block: number[],
  lecturerIds: number[],
  index: ConflictIndex
): boolean {
  for (const slotId of block) {
    for (const lecturerId of lecturerIds) {
      if (index.lecturerTimeUsed.has(`lec:${lecturerId}:slot:${slotId}`)) return true;
    }
  }
  return false;
}

function sameLecturerSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort((x, y) => x - y);
  const bb = [...b].sort((x, y) => x - y);
  return aa.every((value, index) => value === bb[index]);
}

function lecturerAlternatives(
  candidate: PreGACandidate,
  currentLecturerIds: number[]
): number[][] {
  const pool = candidate.lecturerPool;
  if (pool.length === 0) return [];

  const size = Math.min(Math.max(1, currentLecturerIds.length), pool.length);
  if (size === 1) {
    return fisherYatesShuffle(pool).map(lecturerId => [lecturerId]);
  }

  const shuffled = fisherYatesShuffle(pool);
  const seen = new Set<string>();
  const alternatives: number[][] = [];
  for (let start = 0; start < shuffled.length; start++) {
    const candidateIds = Array.from(
      { length: size },
      (_, offset) => shuffled[(start + offset) % shuffled.length]!
    ).sort((a, b) => a - b);
    const key = candidateIds.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push(candidateIds);
  }
  return alternatives;
}

function pickLecturerSwapForBlock(
  block: number[],
  candidate: PreGACandidate,
  currentLecturerIds: number[],
  index: ConflictIndex
): number[] | null {
  for (const lecturerIds of lecturerAlternatives(candidate, currentLecturerIds)) {
    if (sameLecturerSet(lecturerIds, currentLecturerIds)) continue;
    if (!lecturerConflicts(block, lecturerIds, index)) {
      return lecturerIds;
    }
  }
  return null;
}

/**
 * Full contiguous-block repair: if the session has any conflict, replace the
 * entire block with a non-conflicting contiguous block. Falls back through:
 *   1. A clean block on the same room.
 *   2. (FLEXIBLE only) a clean block on any allowed room.
 *   3. Any contiguous block on the same room (residual conflict accepted).
 *   4. Same-day fragmented block from the Phase 16 shared selector.
 *   5. The original session (no same-day slots exist at all).
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
  const currentRoomOrGeneSlotConflict = roomOrGeneSlotConflicts(
    session.timeSlotIds,
    session.roomId,
    index,
    usedSlotsInGene
  );
  const currentLecturerConflict = lecturerConflicts(session.timeSlotIds, session.lecturerIds, index);
  const currentClean = !currentRoomOrGeneSlotConflict && !currentLecturerConflict;
  if (currentClean && session.timeSlotIds.length === sessionDuration) {
    return session;
  }

  // Phase 15 #9: if the only current conflict is lecturer-time, first try to
  // keep the room/time assignment and swap the session lecturer from the
  // candidate's cohort pool. Room / slot repair is the fallback.
  if (
    session.timeSlotIds.length === sessionDuration &&
    currentLecturerConflict &&
    !currentRoomOrGeneSlotConflict
  ) {
    const lecturerIds = pickLecturerSwapForBlock(
      session.timeSlotIds,
      candidate,
      session.lecturerIds,
      index
    );
    if (lecturerIds) {
      return { roomId: session.roomId, timeSlotIds: [...session.timeSlotIds], lecturerIds };
    }
  }

  const blocks = findContiguousSlots(candidate.possibleTimeSlotIds, sessionDuration, lookup);
  if (blocks.length === 0) {
    // note (Phase 16 #7 / OQ-33): no full contiguous block exists for this
    // candidate, but repair should still move the session onto the same-day
    // degraded shape shared by chromosome seeding and mutation. The resulting
    // in-day gap is charged by `fragmentationPenalty`; the key invariant here
    // is that repair never preserves or creates a cross-day fallback when it
    // has any same-day slot metadata to work with.
    const fallbackBlock = pickSameDaySessionSlots(
      candidate.possibleTimeSlotIds,
      sessionDuration,
      lookup,
      candidate.fragmentationRequired,
    );
    if (fallbackBlock.length === 0) {
      return session; // no resolvable slots; future telemetry can count this abort
    }

    if (!roomOrGeneSlotConflicts(fallbackBlock, session.roomId, index, usedSlotsInGene)) {
      if (!lecturerConflicts(fallbackBlock, session.lecturerIds, index)) {
        return { roomId: session.roomId, timeSlotIds: fallbackBlock, lecturerIds: [...session.lecturerIds] };
      }
      const lecturerIds = pickLecturerSwapForBlock(fallbackBlock, candidate, session.lecturerIds, index);
      if (lecturerIds) return { roomId: session.roomId, timeSlotIds: fallbackBlock, lecturerIds };
    }

    if (geneKind === 'FLEXIBLE' && candidate.possibleRoomIds?.length) {
      for (const altRoom of fisherYatesShuffle(candidate.possibleRoomIds)) {
        if (altRoom === session.roomId) continue;
        if (roomOrGeneSlotConflicts(fallbackBlock, altRoom, index, usedSlotsInGene)) continue;
        if (!lecturerConflicts(fallbackBlock, session.lecturerIds, index)) {
          return { roomId: altRoom, timeSlotIds: fallbackBlock, lecturerIds: [...session.lecturerIds] };
        }
        const lecturerIds = pickLecturerSwapForBlock(fallbackBlock, candidate, session.lecturerIds, index);
        if (lecturerIds) return { roomId: altRoom, timeSlotIds: fallbackBlock, lecturerIds };
      }
    }

    const fallbackLecturerIds =
      pickLecturerSwapForBlock(fallbackBlock, candidate, session.lecturerIds, index) ??
      [...session.lecturerIds];
    return { roomId: session.roomId, timeSlotIds: fallbackBlock, lecturerIds: fallbackLecturerIds };
  }

  const shuffledBlocks = fisherYatesShuffle(blocks);

  // 1. Try a clean block on the current room.
  for (const block of shuffledBlocks) {
    if (roomOrGeneSlotConflicts(block, session.roomId, index, usedSlotsInGene)) continue;
    if (!lecturerConflicts(block, session.lecturerIds, index)) {
      return { roomId: session.roomId, timeSlotIds: block, lecturerIds: [...session.lecturerIds] };
    }
    const lecturerIds = pickLecturerSwapForBlock(block, candidate, session.lecturerIds, index);
    if (lecturerIds) return { roomId: session.roomId, timeSlotIds: block, lecturerIds };
  }

  // 2. FLEXIBLE: try a clean block on any other allowed room.
  if (geneKind === 'FLEXIBLE' && candidate.possibleRoomIds?.length) {
    const shuffledRooms = fisherYatesShuffle(candidate.possibleRoomIds);
    for (const altRoom of shuffledRooms) {
      if (altRoom === session.roomId) continue;
      for (const block of shuffledBlocks) {
        if (roomOrGeneSlotConflicts(block, altRoom, index, usedSlotsInGene)) continue;
        if (!lecturerConflicts(block, session.lecturerIds, index)) {
          return { roomId: altRoom, timeSlotIds: block, lecturerIds: [...session.lecturerIds] };
        }
        const lecturerIds = pickLecturerSwapForBlock(block, candidate, session.lecturerIds, index);
        if (lecturerIds) return { roomId: altRoom, timeSlotIds: block, lecturerIds };
      }
    }
  }

  // 3. No clean placement found. Pick any contiguous block on the current room.
  // GA fitness will penalise the residual collision; contiguity is preserved.
  const fallbackBlock = shuffledBlocks[0]!;
  const fallbackLecturerIds =
    pickLecturerSwapForBlock(fallbackBlock, candidate, session.lecturerIds, index) ??
    [...session.lecturerIds];
  return { roomId: session.roomId, timeSlotIds: fallbackBlock, lecturerIds: fallbackLecturerIds };
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

  const currentRoomConflict = session.timeSlotIds.some(
    slotId => index.roomTimeUsed.has(`room:${roomId}:slot:${slotId}`)
  );
  const currentLecturerConflict = lecturerConflicts(session.timeSlotIds, session.lecturerIds, index);
  if (currentLecturerConflict && !currentRoomConflict && session.timeSlotIds.length === needed) {
    const lecturerIds = pickLecturerSwapForBlock(
      session.timeSlotIds,
      candidate,
      session.lecturerIds,
      index
    );
    if (lecturerIds) {
      return { roomId, timeSlotIds: [...session.timeSlotIds], lecturerIds };
    }
  }

  for (const slotId of session.timeSlotIds) {
    if (!slotConflicts(slotId, roomId, session.lecturerIds, index) && !usedSlots.has(slotId)) {
      newSlots.push(slotId);
      usedSlots.add(slotId);
    }
  }

  if (newSlots.length < needed) {
    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    for (const slotId of shuffledSlots) {
      if (newSlots.length >= needed) break;
      if (usedSlots.has(slotId)) continue;
      if (!slotConflicts(slotId, roomId, session.lecturerIds, index)) {
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

  return { roomId, timeSlotIds: newSlots, lecturerIds: [...session.lecturerIds] };
}

/**
 * Capacity-shortfall repair (Phase 11 task #7).
 *
 * Runs only on FLEXIBLE genes whose candidate has `roomId === null` and more
 * than one parallel session — the null-room overflow shape introduced by the
 * Phase 11 per-session seeder. For other shapes (FIXED, pre-assigned, single-
 * session null-room) capacity is already satisfied by validator construction,
 * so this pass is a no-op.
 *
 * When `Σ session.room.capacity < effectiveStudentCount`, we greedily swap the
 * weakest session's roomId toward a higher-capacity entry from
 * `possibleRoomIds`, skipping any swap that would introduce a room-time
 * collision with another gene (per the conflict index) or with a sibling
 * session of this gene. Each iteration upgrades at most one session; we bound
 * the outer loop at `parallelSessionCount` upgrades since further upgrades
 * tend to chase diminishing returns — capacity-shortfall remains a soft
 * penalty (task #6), so the GA's selection pressure can still drive the rest.
 */
function repairCapacityShortfall(
  gene: Gene,
  candidate: PreGACandidate,
  index: ConflictIndex,
  roomById: ReadonlyMap<number, Room>,
): void {
  if (gene.kind !== 'FLEXIBLE') return;
  if (candidate.roomId !== null) return;
  if (gene.sessions.length <= 1) return;
  const pool = candidate.possibleRoomIds;
  if (!pool?.length) return;

  const capacityOf = (roomId: number): number => roomById.get(roomId)?.capacity ?? 0;
  const required = candidate.effectiveStudentCount;
  const totalCapacity = (): number =>
    gene.sessions.reduce((sum, s) => sum + capacityOf(s.roomId), 0);

  if (totalCapacity() >= required) return;

  for (let iter = 0; iter < gene.sessions.length; iter++) {
    if (totalCapacity() >= required) return;

    // Try to upgrade the weakest session first; if it can't move, fall through
    // to the next-weakest. Bounded by the session order length per iteration.
    const order = gene.sessions
      .map((_, i) => i)
      .sort((a, b) => capacityOf(gene.sessions[a]!.roomId) - capacityOf(gene.sessions[b]!.roomId));

    let progressed = false;
    for (const idx of order) {
      const session = gene.sessions[idx]!;
      const currentCap = capacityOf(session.roomId);

      const alternatives = pool
        .filter(rid => rid !== session.roomId && capacityOf(rid) > currentCap)
        .sort((a, b) => capacityOf(b) - capacityOf(a));
      if (alternatives.length === 0) continue;

      // Sibling sessions of THIS gene reserve their own (room, slot) pairs —
      // never let the swap collide with them. The conflict index already
      // excludes this gene, so its sibling rooms aren't in there.
      const siblingRoomSlots = new Set<string>();
      for (let i = 0; i < gene.sessions.length; i++) {
        if (i === idx) continue;
        const sib = gene.sessions[i]!;
        for (const sid of sib.timeSlotIds) {
          siblingRoomSlots.add(`room:${sib.roomId}:slot:${sid}`);
        }
      }

      for (const altRoom of alternatives) {
        let conflict = false;
        for (const sid of session.timeSlotIds) {
          const key = `room:${altRoom}:slot:${sid}`;
          if (index.roomTimeUsed.has(key) || siblingRoomSlots.has(key)) {
            conflict = true;
            break;
          }
        }
        if (!conflict) {
          session.roomId = altRoom;
          progressed = true;
          break;
        }
      }
      if (progressed) break;
    }
    if (!progressed) return;
  }
}

export function repairChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lookup?: SlotLookup,
  roomById?: ReadonlyMap<number, Room>,
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  const repaired: Gene[] = chromosome.map(g => ({
    ...g,
    sessions: g.sessions.map(s => ({
      roomId: s.roomId,
      timeSlotIds: [...s.timeSlotIds],
      lecturerIds: [...s.lecturerIds],
    })),
  }));

  for (const gene of repaired) {
    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) continue;

    const index = buildConflictIndex(repaired, gene.offeringId);

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
                { roomId: session.roomId, timeSlotIds: session.timeSlotIds, lecturerIds: session.lecturerIds },
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

    // Phase 11 task #7 — after collision repair, nudge null-room overflow
    // genes toward higher-capacity rooms when combined capacity is short.
    if (roomById) {
      repairCapacityShortfall(gene, candidate, index, roomById);
    }
  }

  return repaired;
}
