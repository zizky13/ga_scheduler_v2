/**
 * SSA Phase 0 — Static Exclusion
 *
 * For every Fixed Room candidate, register the (Room, TimeSlot) coordinates
 * it WILL occupy as locked. Then remove those coordinates from the
 * possibleTimeSlotIds of any Flexible candidate sharing the same room.
 *
 * This must run BEFORE AC-3 and Hopcroft-Karp so the bipartite graph
 * reflects the true available domain for flexible sessions.
 */

import type { PreGACandidate } from '../types.js';

export interface StaticExclusionResult {
  lockedCoordinates: Set<string>;   // Format: `${roomId}:${slotId}`
  prunedCandidates: PreGACandidate[];
}

export function runStaticExclusion(
  candidates: PreGACandidate[]
): StaticExclusionResult {
  const fixedCandidates = candidates.filter(c => c.isFixedRoom);
  const flexibleCandidates = candidates.filter(c => !c.isFixedRoom);

  const lockedCoordinates = new Set<string>();

  for (const fixed of fixedCandidates) {
    for (const slotId of fixed.possibleTimeSlotIds) {
      lockedCoordinates.add(`${fixed.roomId}:${slotId}`);
    }
  }

  const prunedFlexible: PreGACandidate[] = flexibleCandidates.map(flexible => ({
    ...flexible,
    possibleTimeSlotIds: flexible.possibleTimeSlotIds.filter(
      slotId => !lockedCoordinates.has(`${flexible.roomId}:${slotId}`)
    ),
  }));

  return {
    lockedCoordinates,
    prunedCandidates: [...fixedCandidates, ...prunedFlexible],
  };
}
