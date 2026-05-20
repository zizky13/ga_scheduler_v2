/**
 * Entity Tagger — Pre-GA Layer 1
 *
 * Tags each candidate with isFixedRoom based on whether the Kaprodi
 * has manually locked a room assignment (via Lock Room UI / LockedRoom table).
 *
 * A locked room means the GA may only vary the TimeSlotID for this candidate —
 * the RoomID is frozen for the entire evolutionary process and is structurally
 * enforced by the FixedRoomGene discriminated union type.
 *
 * `lockedRoomMap` is a legacy in-process proxy for the LockedRoom DB table
 * (techspec §5.4 / FR-01). Production runs build it from the LockedRoom table
 * directly (see `src/repo/scheduleRepo.ts:fetchSchedulingInputs`); the
 * Pre-GA validator builds an equivalent map from `CourseOffering` rows where
 * `isFixed === true && roomId !== null` — both forms carry the same meaning:
 * "offerings whose room was pinned out-of-band, before the GA runs." Phase 10
 * decoupled this from `CourseOffering.isFixed` alone: an offering with
 * `isFixed: true, roomId: null` is "fixed time, flexible room" and never
 * lands in the map.
 */

import type { PreGACandidate } from '../types.js';

export function tagEntities(
  candidates: PreGACandidate[],
  lockedRoomMap: ReadonlyMap<number, number> // offeringId → lockedRoomId
): PreGACandidate[] {
  return candidates.map(candidate => {
    const lockedRoomId = lockedRoomMap.get(candidate.offeringId);
    if (lockedRoomId !== undefined && lockedRoomId !== null) {
      // Defensive: validator.ts (Phase 10 #1) already strips null-roomId entries
      // from the map, so this branch should always see a real number. The `!== null`
      // guard belts-and-suspenders the contract `isFixedRoom === true ⇒ roomId: number`
      // in case a future caller widens the map's value type.
      return {
        ...candidate,
        roomId: lockedRoomId,
        isFixedRoom: true,
      };
    }
    // No lock: candidate.roomId may be null here — the GA chromosome seeder
    // picks a random initial room from possibleRoomIds in that case.
    return { ...candidate, isFixedRoom: false };
  });
}
