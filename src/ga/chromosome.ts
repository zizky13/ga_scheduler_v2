/**
 * GA — Chromosome Operations
 *
 * Fisher-Yates shuffle for unbiased randomization.
 * createGeneFromCandidate constructs a typed gene (FIXED | FLEXIBLE).
 * createRandomChromosome builds a single candidate timetable.
 * findContiguousSlots locates back-to-back slot blocks on the same day.
 */

import type { Chromosome, Gene, PreGACandidate, TimeSlot } from '../types.js';

// ─── Slot Lookup Cache ───────────────────────────────────────────

/** Pre-computed lookup table mapping slot IDs to their TimeSlot objects. */
export type SlotLookup = Map<number, TimeSlot>;

/**
 * Build a SlotLookup from the full TimeSlot array.
 * Call once per pipeline run and pass to all functions that need day/time info.
 */
export function buildSlotLookup(allTimeSlots: TimeSlot[]): SlotLookup {
  return new Map(allTimeSlots.map(ts => [ts.id, ts]));
}

// ─── Contiguous Slot Finder (Task 17) ────────────────────────────

/**
 * Find all contiguous (back-to-back, same-day) slot blocks of the
 * requested `duration` from within `availableSlotIds`.
 *
 * A slot sequence [s₁, s₂, …, sₙ] is contiguous iff for every
 * adjacent pair (sᵢ, sᵢ₊₁):
 *   1. Both slots fall on the **same day**.
 *   2. sᵢ.endTime === sᵢ₊₁.startTime   (back-to-back, no gap).
 *
 * @param availableSlotIds  Slot IDs the candidate may use (from
 *                          `PreGACandidate.possibleTimeSlotIds`).
 * @param duration          Number of consecutive slots required
 *                          (from `PreGACandidate.sessionDuration`).
 * @param lookup            Pre-built SlotLookup (from `buildSlotLookup`).
 * @returns An array of valid contiguous blocks. Each block is an
 *          array of `duration` slot IDs sorted chronologically.
 *          Returns `[]` when no valid block exists (e.g. duration
 *          exceeds available slots per day). When `duration === 1`
 *          every available slot is its own valid block.
 */
export function findContiguousSlots(
  availableSlotIds: number[],
  duration: number,
  lookup: SlotLookup
): number[][] {
  if (duration <= 0) return [];
  if (availableSlotIds.length < duration) return [];

  // Resolve IDs to full TimeSlot objects, skipping unknown IDs
  const resolved = availableSlotIds
    .map(id => lookup.get(id))
    .filter((ts): ts is TimeSlot => ts !== undefined);

  if (resolved.length < duration) return [];

  // Group by day
  const byDay = new Map<string, TimeSlot[]>();
  for (const ts of resolved) {
    const bucket = byDay.get(ts.day) ?? [];
    bucket.push(ts);
    byDay.set(ts.day, bucket);
  }

  const blocks: number[][] = [];

  for (const [, daySlots] of byDay) {
    if (daySlots.length < duration) continue;

    // Sort chronologically by startTime within the day
    daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Sliding window: find every run of `duration` back-to-back slots
    // We build chains of contiguous slots, then extract windows of size `duration`.
    // A chain breaks whenever daySlots[i].endTime !== daySlots[i+1].startTime.

    let chainStart = 0;
    for (let i = 1; i <= daySlots.length; i++) {
      // Check if chain continues
      const continues =
        i < daySlots.length &&
        daySlots[i - 1]!.endTime === daySlots[i]!.startTime;

      if (!continues) {
        // Chain [chainStart..i-1] just ended. Extract all windows of size `duration`.
        const chainLen = i - chainStart;
        if (chainLen >= duration) {
          for (let w = chainStart; w <= i - duration; w++) {
            blocks.push(daySlots.slice(w, w + duration).map(s => s.id));
          }
        }
        chainStart = i;
      }
    }
  }

  return blocks;
}

// ─── Core Helpers ────────────────────────────────────────────────

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
 * Pick `count` distinct contiguous blocks from `blocks` using Fisher-Yates
 * on the block array. If fewer than `count` blocks exist, duplicates are
 * permitted (the GA will penalise collisions via fitness anyway).
 */
function pickDistinctBlocks(blocks: number[][], count: number): number[][] {
  if (blocks.length === 0) return [];
  const shuffled = fisherYatesShuffle(blocks);
  const result: number[][] = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length]!);
  }
  return result;
}

/**
 * Create a typed gene from a candidate.
 * isFixedRoom=true  → FixedRoomGene (kind: 'FIXED'); roomId is immutable.
 * isFixedRoom=false → FlexibleGene  (kind: 'FLEXIBLE'); roomId is mutable.
 *
 * Each gene carries `sessions[]` — one entry per parallel group.
 * Each session holds a `roomId` and `timeSlotIds` (length = sessionDuration).
 *
 * When a `SlotLookup` is supplied, contiguous blocks are enforced via
 * `findContiguousSlots` (Task 18). Falls back to a shuffled-slice when no
 * contiguous blocks exist (degenerate timetable / sessionDuration = 1).
 */
export function createGeneFromCandidate(
  candidate: PreGACandidate,
  lookup?: SlotLookup
): Gene {
  const { parallelSessionCount, sessionDuration } = candidate;

  // When the offering has no chosen seed room (CourseOffering.roomId is null),
  // pick a random initial seed from possibleRoomIds. FIXED candidates always
  // carry a non-null roomId via LockedRoom or isFixed → roomId mapping.
  let seedRoomId: number;
  if (candidate.roomId != null) {
    seedRoomId = candidate.roomId;
  } else {
    const pool = candidate.possibleRoomIds ?? [];
    if (pool.length === 0) {
      throw new Error(
        `Candidate ${candidate.offeringId} has null roomId and empty possibleRoomIds — pre-GA validator should have filtered this offering as infeasible`
      );
    }
    seedRoomId = pool[Math.floor(Math.random() * pool.length)]!;
  }
  const roomId = seedRoomId;

  let sessions: { roomId: number; timeSlotIds: number[] }[];

  if (lookup) {
    const blocks = findContiguousSlots(candidate.possibleTimeSlotIds, sessionDuration, lookup);

    if (blocks.length > 0) {
      const picked = pickDistinctBlocks(blocks, parallelSessionCount);
      sessions = picked.map(block => ({ roomId, timeSlotIds: block }));
    } else {
      // Fallback: no contiguous blocks available (edge case)
      const shuffled = fisherYatesShuffle(candidate.possibleTimeSlotIds);
      sessions = Array.from({ length: parallelSessionCount }, (_, i) => ({
        roomId,
        timeSlotIds: shuffled.slice(i * sessionDuration, (i + 1) * sessionDuration),
      }));
    }
  } else {
    // Legacy path (no lookup) — plain shuffle, kept for backward-compat
    const shuffled = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    sessions = Array.from({ length: parallelSessionCount }, (_, i) => ({
      roomId,
      timeSlotIds: shuffled.slice(i * sessionDuration, (i + 1) * sessionDuration),
    }));
  }

  if (candidate.isFixedRoom) {
    return {
      kind: 'FIXED',
      offeringId: candidate.offeringId,
      sessions,
    };
  }

  return {
    kind: 'FLEXIBLE',
    offeringId: candidate.offeringId,
    sessions,
  };
}

/**
 * Create a single random chromosome.
 * Each gene assigns `parallelSessionCount` contiguous time-slot blocks.
 * When a `SlotLookup` is supplied (Task 18), genes are guaranteed to have
 * valid contiguous slots via `findContiguousSlots`.
 */
export function createRandomChromosome(
  candidates: PreGACandidate[],
  noiseRate: number = 0.15,
  lookup?: SlotLookup
): Chromosome {
  return candidates.map(candidate => {
    return createGeneFromCandidate(candidate, lookup);
  });
}
