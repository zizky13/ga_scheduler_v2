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
 * In this backend-only implementation, lockedRoomMap is built from
 * CourseOffering.isFixed. In the full stack version, it is populated
 * from the LockedRoom DB table via FR-01 (Lock Room UI).
 */

import type { PreGACandidate } from '../types.js';

export function tagEntities(
  candidates: PreGACandidate[],
  lockedRoomMap: Map<number, number> // offeringId → lockedRoomId
): PreGACandidate[] {
  return candidates.map(candidate => {
    const lockedRoomId = lockedRoomMap.get(candidate.offeringId);
    if (lockedRoomId !== undefined) {
      // Null-safe: lock unconditionally overwrites candidate.roomId, so a null
      // seed from an offering with no chosen room still resolves to the locked id.
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
