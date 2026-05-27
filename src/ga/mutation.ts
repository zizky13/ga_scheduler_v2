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
 *
 * Phase 15 #6: a third per-session lecturer dimension is mutable when the
 * gene's parent candidate is a multi-sibling cohort
 * (`siblingOfferingIds.length > 1`). `mutateLecturer` re-picks one random
 * session's `lecturerIds` from `candidate.lecturerPool`; single-offering
 * candidates are no-ops (lecturers are locked at seed time per OQ-26
 * legacy semantics). The lecturer dimension is mutated alongside room/slot
 * — both share the per-gene mutation-rate gate.
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
 * Phase 15 #5 — seeder distribution for the per-session lecturer dimension.
 * Single-sibling cohorts stamp `candidate.lecturerIds` on every session;
 * multi-sibling cohorts walk `siblingLecturerGroups` round-robin. Used only
 * as a fallback when the room/slot rebuild needs to materialise a session
 * index that did not exist in the prior gene (defensive — parallelSession
 * Count is fixed, so this branch is unreachable in normal operation).
 */
function pickLecturersForSession(candidate: PreGACandidate, sessionIndex: number): number[] {
  if (candidate.siblingOfferingIds.length <= 1) {
    return [...candidate.lecturerIds];
  }
  const groups = candidate.siblingLecturerGroups;
  return [...groups[sessionIndex % groups.length]!];
}

/**
 * Phase 15 #6 — room/slot mutation should preserve the prior session's
 * lecturerIds (the lecturer dimension is mutated separately by
 * `mutateLecturer`). Falls back to the seeder distribution only when the
 * new session index has no prior counterpart — defensive; in practice every
 * mutation preserves `parallelSessionCount`, so this branch is unreachable.
 */
function carryLecturersForSession(
  candidate: PreGACandidate,
  priorSessions: GeneSession[],
  sessionIndex: number,
): number[] {
  const prior = priorSessions[sessionIndex];
  if (prior !== undefined) return [...prior.lecturerIds];
  return pickLecturersForSession(candidate, sessionIndex);
}

/**
 * Fallback: build sessions with a plain shuffle-and-slice (pre-Task-18 logic).
 * `pickRoom` is invoked once per session — callers pick either a shared
 * seed roomId (single-session / pre-assigned shapes) or an independent
 * per-session draw (Phase 11 null-room overflow). Phase 15 #6: lecturer
 * dimension is carried over from the prior session at the same index so
 * room/slot mutation never resets a lecturer assignment that earlier
 * generations of `mutateLecturer` may have evolved.
 */
function buildSessionsFallback(
  candidate: PreGACandidate,
  priorSessions: GeneSession[],
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
    lecturerIds: carryLecturersForSession(candidate, priorSessions, i),
  }));
}

/**
 * Phase 15 #6 — per-session lecturer mutation. Picks one random session of
 * `sessions` and re-picks its `lecturerIds` from `candidate.lecturerPool`.
 *
 *   - Only fires for multi-sibling cohorts (`siblingOfferingIds.length > 1`).
 *     Single-offering candidates have their lecturers locked at seed time
 *     (OQ-26 legacy semantics — preserves backward compat for any pre-Phase
 *     -15 fixture / team-taught offering).
 *   - Single-lecturer sessions (`session.lecturerIds.length === 1`) draw one
 *     new lecturer from the pool. The draw may land on the current lecturer;
 *     that is a no-op mutation and statistically equivalent to skipping the
 *     gene — acceptable under the existing mutation-rate envelope.
 *   - Team-teach sessions (`session.lecturerIds.length > 1`) draw a same-size
 *     random subset from the pool (preserving session cardinality so OQ-25's
 *     team-teach affordance survives the mutation).
 *   - Cohort-shape invariant — the pool is non-empty (the validator rejects
 *     `COHORT_LECTURER_POOL_EMPTY` upstream), so this function always
 *     produces a valid `lecturerIds`. Returns the input array reference
 *     when the gating conditions are not met (no allocation on the no-op
 *     path).
 *
 * The returned array uses copy-on-write at the mutated index — sibling
 * sessions are reused by reference, matching the rest of the mutation
 * pipeline's per-locus allocation style.
 */
function mutateLecturer(
  sessions: GeneSession[],
  candidate: PreGACandidate,
): GeneSession[] {
  if (candidate.siblingOfferingIds.length <= 1) return sessions;
  if (sessions.length === 0) return sessions;
  const pool = candidate.lecturerPool;
  if (pool.length === 0) return sessions;

  const idx = Math.floor(Math.random() * sessions.length);
  const target = sessions[idx]!;

  const currentSize = Math.max(1, target.lecturerIds.length);
  const size = Math.min(currentSize, pool.length);

  let newLecturerIds: number[];
  if (size === 1) {
    newLecturerIds = [pool[Math.floor(Math.random() * pool.length)]!];
  } else {
    const shuffled = fisherYatesShuffle(pool);
    newLecturerIds = shuffled.slice(0, size).sort((a, b) => a - b);
  }

  const next = sessions.slice();
  next[idx] = {
    roomId: target.roomId,
    timeSlotIds: target.timeSlotIds,
    lecturerIds: newLecturerIds,
  };
  return next;
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

      // Phase 15 #6 — compose per-session lecturer mutation alongside the
      // room/slot rebuild. No-ops for single-sibling cohorts (which include
      // every pre-Phase-15 fixture / legacy team-taught offering).
      newSessions = mutateLecturer(newSessions, candidate);

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
        lecturerIds: carryLecturersForSession(candidate, gene.sessions, i),
      }));
    } else {
      newSessions = buildSessionsFallback(candidate, gene.sessions, pickRoomForSession, parallelSessionCount);
    }

    // Phase 15 #6 — same composition for FLEXIBLE genes; multi-sibling cohorts
    // mutate one session's lecturerIds alongside the room/slot rebuild.
    newSessions = mutateLecturer(newSessions, candidate);

    return {
      ...gene,
      sessions: newSessions,
    };
  });
}
