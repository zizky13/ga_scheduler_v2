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

  for (const candidate of candidates) {
    // Compute valid contiguous block START slot ids once per candidate.
    // Each parallel session of the same offering has identical eligibility,
    // so they share this set.
    const blockStarts = computeBlockStarts(candidate, lookup);

    for (let i = 0; i < candidate.parallelSessionCount; i++) {
      const sessionId = candidate.offeringId * 100 + i;
      sessions.push({
        sessionId,
        offeringId: candidate.offeringId,
        sessionIndex: i,
        roomId: candidate.roomId,
        lecturerIds: candidate.lecturerIds,
      });
      adjacency.set(sessionId, new Set(blockStarts));
      blockStarts.forEach(s => slotIdSet.add(s));
    }
  }

  const slots: SlotNode[] = Array.from(slotIdSet).map(id => ({ slotId: id }));

  return { sessions, slots, adjacency };
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
): number[] {
  if (!lookup) return [...candidate.possibleTimeSlotIds];
  const blocks = findContiguousSlots(
    candidate.possibleTimeSlotIds,
    candidate.sessionDuration,
    lookup
  );
  if (blocks.length === 0) return [...candidate.possibleTimeSlotIds];
  return blocks.map(b => b[0]!);
}
