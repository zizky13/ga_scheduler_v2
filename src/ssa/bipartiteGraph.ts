/**
 * SSA — Bipartite Graph Construction
 *
 * Builds a bipartite graph where:
 *   Left nodes  = individual sessions (one per parallel group of an offering)
 *   Right nodes = contiguous **block start** positions — each block represents
 *                 `sessionDuration` consecutive same-day slots from the
 *                 candidate's `possibleTimeSlotIds`. The block's identity is
 *                 the start slot id, so two sessions competing for the same
 *                 contiguous chunk share a single right node.
 *   Edges       = session can place its block at this start position.
 *
 * Task 22 — SKS Blocks: previously the graph treated isolated slots as right
 * nodes, which let Hopcroft-Karp claim feasibility for multi-SKS courses by
 * matching only the first slot. Now each session must find a `sessionDuration`-
 * length contiguous block; HK proves feasibility for whole chunks.
 *
 * Backward compatibility: when `allTimeSlots` is omitted the function falls
 * back to per-slot adjacency. This keeps callers that pre-date the SKS-block
 * refactor working when every candidate has `sessionDuration === 1`.
 */

import type { PreGACandidate, SessionNode, SlotNode, BipartiteGraph, TimeSlot } from '../types.js';
import { buildSlotLookup, findContiguousSlots, type SlotLookup } from '../ga/chromosome.js';

export function buildBipartiteGraph(
  candidates: PreGACandidate[],
  allTimeSlots?: TimeSlot[]
): BipartiteGraph {
  const lookup: SlotLookup | undefined = allTimeSlots
    ? buildSlotLookup(allTimeSlots)
    : undefined;

  const sessions: SessionNode[] = [];
  const slotIdSet = new Set<number>();
  const adjacency = new Map<number, Set<number>>();
  const degradedOfferings = new Set<number>();

  for (const candidate of candidates) {
    // Compute valid contiguous block START slot ids once per candidate.
    // Each parallel session of the same offering has identical eligibility,
    // so they share this set.
    const { blockStarts, degraded } = computeBlockStarts(candidate, lookup);
    if (degraded) degradedOfferings.add(candidate.offeringId);
    const lecturerIdsForSSA =
      candidate.siblingOfferingIds.length > 1
        ? candidate.lecturerPool
        : candidate.lecturerIds;

    for (let i = 0; i < candidate.parallelSessionCount; i++) {
      const sessionId = candidate.offeringId * 100 + i;
      sessions.push({
        sessionId,
        offeringId: candidate.offeringId,
        sessionIndex: i,
        // note: candidate.roomId is null for FLEXIBLE offerings with no
        // LockedRoom. SessionNode.roomId carries it through as `number | null`
        // — AC-3 treats null as a free CSP variable (see ac3.ts), and
        // Hopcroft-Karp matches only on the slot adjacency map.
        //
        // note (Phase 11 task #9 — null-room overflow audit): when
        // `candidate.roomId === null && parallelSessionCount > 1`, every
        // sibling session emitted here carries `roomId: null`. AC-3's
        // shared-room guard (`sessionI.roomId !== null && ...`) skips them
        // from room-grouping, so siblings don't get a spurious self-conflict
        // — exactly the topology the per-session room seeder relies on. HK
        // still matches each session to a DISTINCT block-start slot, which
        // is STRICTER than OQ-18's runtime tolerance (same-slot/different-
        // room siblings are legal in the GA). The SSA is sound — declaring
        // FEASIBLE here means the GA can do at least this well — but the
        // gap means SSA may flag a configuration INFEASIBLE that OQ-18's
        // room-sharing could rescue. Acceptable for an admissibility check.
        roomId: candidate.roomId,
        // note (Phase 15 task #11): for multi-sibling cohort candidates, SSA
        // stamps every SessionNode with the full `lecturerPool`, not the GA's
        // eventual per-session distribution. SSA proves "this cohort can be
        // scheduled under SOME distribution of lecturerPool across sessions";
        // the GA then finds the actual per-session lecturer assignment. Single
        // sibling candidates keep the legacy `lecturerIds` shape.
        lecturerIds: [...lecturerIdsForSSA],
      });
      adjacency.set(sessionId, new Set(blockStarts));
      blockStarts.forEach(s => slotIdSet.add(s));
    }
  }

  const slots: SlotNode[] = Array.from(slotIdSet).map(id => ({ slotId: id }));

  return { sessions, slots, adjacency, degradedOfferings: Array.from(degradedOfferings) };
}

/**
 * Resolve a candidate's possible block START slots.
 *
 * With a SlotLookup we use `findContiguousSlots` to enumerate every valid
 * `sessionDuration`-length contiguous chunk and take the first slot of each as
 * the block's identity. Without a lookup (back-compat path) we treat every
 * possible slot as its own block — correct only when `sessionDuration === 1`.
 *
 * When no contiguous block exists (e.g., a timetable with only 2 back-to-back
 * slots versus a 3-SKS course), we fall back to per-slot adjacency. This
 * mirrors the GA's own fallback in `chromosome.ts:createGeneFromCandidate`,
 * keeping the SSA's feasibility upper bound consistent with the constraint the
 * GA actually enforces — the SSA should not declare infeasibility for chunks
 * the GA itself relaxes.
 */
function computeBlockStarts(
  candidate: PreGACandidate,
  lookup: SlotLookup | undefined
): { blockStarts: number[]; degraded: boolean } {
  if (!lookup) return { blockStarts: [...candidate.possibleTimeSlotIds], degraded: false };
  const blocks = findContiguousSlots(
    candidate.possibleTimeSlotIds,
    candidate.sessionDuration,
    lookup
  );
  if (blocks.length === 0) {
    return {
      blockStarts: [...candidate.possibleTimeSlotIds],
      degraded: candidate.possibleTimeSlotIds.length > 0,
    };
  }
  return { blockStarts: blocks.map(b => b[0]!), degraded: false };
}
