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
 * Phase 15 #5 — pick the lecturer list for session index `i` in a freshly-
 * built sessions array. Mirrors the chromosome-seeder distribution so the
 * mutation operator preserves the same per-session lecturer semantics:
 * single-sibling cohorts stamp `candidate.lecturerIds` on every session;
 * multi-sibling cohorts walk `siblingLecturerGroups` round-robin. Phase 15 #6
 * will introduce a `mutateLecturer` operator that explores alternate
 * distributions; until then mutation only touches room/slot dimensions and
 * the lecturer dimension stays at its seed value.
 */
function pickLecturersForSession(candidate: PreGACandidate, sessionIndex: number): number[] {
  if (candidate.siblingOfferingIds.length <= 1) {
    return [...candidate.lecturerIds];
  }
  const groups = candidate.siblingLecturerGroups;
  return [...groups[sessionIndex % groups.length]!];
}

/**
 * Fallback: build sessions with a plain shuffle-and-slice (pre-Task-18 logic).
 * `pickRoom` is invoked once per session — callers pick either a shared
 * seed roomId (single-session / pre-assigned shapes) or an independent
 * per-session draw (Phase 11 null-room overflow).
 */
function buildSessionsFallback(
  candidate: PreGACandidate,
  pickRoom: () => number,
  count: number
): GeneSession[] {
  const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
  return Array.from({ length: count }, (_, i) => ({
    roomId: pickRoom(),
    timeSlotIds: shuffledSlots.slice(
      i * candidate.sessionDuration,
      (i + 1) * candidate.sessionDuration
    ),
    lecturerIds: pickLecturersForSession(candidate, i),
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
          lecturerIds: [...session.lecturerIds],
        }));
      } else {
        // Fallback: shuffle-and-slice (preserving room)
        const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
        newSessions = gene.sessions.map((session, i) => ({
          roomId: session.roomId,
          timeSlotIds: shuffledSlots.slice(i * sessionDuration, (i + 1) * sessionDuration),
          lecturerIds: [...session.lecturerIds],
        }));
      }

      return {
        ...gene,
        sessions: newSessions,
      };
    }

    // FLEXIBLE: both roomId and timeSlots are mutable.
    // note: the validator guarantees `possibleRoomIds` is non-empty for every
    // FLEXIBLE candidate (offerings with zero qualifying rooms are rejected
    // as NO_ROOMS_QUALIFY / NO_FACILITY_MATCH), so the truthy branch always
    // fires for seed selection. The fallback exists only to satisfy the type
    // checker — `candidate.roomId` may be null post-Phase-7, but it's
    // unreachable for FLEXIBLE candidates with a populated pool.
    //
    // Phase 11 task #5 — candidate-shape branching for per-session room
    // mutation:
    // note (OQ-15/16/17): when `candidate.roomId === null && parallelSession
    // Count > 1` the offering is split ACROSS rooms (null-room overflow), so
    // each session re-picks its roomId independently from possibleRoomIds.
    // Single-session FLEXIBLE genes (parallelSessionCount === 1) keep the
    // shared-room mutation per OQ-17; pre-assigned-room FLEXIBLE genes
    // (candidate.roomId !== null, multi-timeslot split) keep it per OQ-16.
    // FIXED genes were already returned above — their roomId is mask-immutable.
    const isMultiRoomSplit = candidate.roomId == null && parallelSessionCount > 1;

    const seedRoomId: number = candidate.possibleRoomIds?.length
      ? candidate.possibleRoomIds[
          Math.floor(Math.random() * candidate.possibleRoomIds.length)
        ]!
      : (gene.sessions[0]?.roomId ?? candidate.roomId ?? 0);

    const pickRoomForSession = (): number => {
      if (!isMultiRoomSplit) return seedRoomId;
      const pool = candidate.possibleRoomIds!;
      return pool[Math.floor(Math.random() * pool.length)]!;
    };

    let newSessions: GeneSession[];

    if (blocks && blocks.length > 0) {
      const picked = pickBlocks(blocks, parallelSessionCount);
      newSessions = picked.map((block, i) => ({
        roomId: pickRoomForSession(),
        timeSlotIds: block,
        lecturerIds: pickLecturersForSession(candidate, i),
      }));
    } else {
      newSessions = buildSessionsFallback(candidate, pickRoomForSession, parallelSessionCount);
    }

    return {
      ...gene,
      sessions: newSessions,
    };
  });
}
