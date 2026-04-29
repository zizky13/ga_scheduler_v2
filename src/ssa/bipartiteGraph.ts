/**
 * SSA — Bipartite Graph Construction
 * 
 * Builds a bipartite graph where:
 *   Left nodes  = individual sessions (expanded from offerings)
 *   Right nodes = available time slots
 *   Edges       = session can be assigned to slot
 */

import type { PreGACandidate, SessionNode, SlotNode, BipartiteGraph } from '../types.js';

export function buildBipartiteGraph(candidates: PreGACandidate[]): BipartiteGraph {
  const sessions: SessionNode[] = [];
  const slotIdSet = new Set<number>();

  // Expand offerings into individual sessions
  for (const candidate of candidates) {
    for (let i = 0; i < candidate.requiredSessions; i++) {
      const sessionId = candidate.offeringId * 100 + i;
      sessions.push({
        sessionId,
        offeringId: candidate.offeringId,
        sessionIndex: i,
        roomId: candidate.roomId,
        lecturerIds: candidate.lecturerIds,
      });
      candidate.possibleTimeSlotIds.forEach(s => slotIdSet.add(s));
    }
  }

  const slots: SlotNode[] = Array.from(slotIdSet).map(id => ({ slotId: id }));

  // Build adjacency: initially each session can use ALL its possible slots.
  // AC-3 will prune this before Hopcroft-Karp runs.
  const adjacency = new Map<number, Set<number>>();
  for (const session of sessions) {
    const candidate = candidates.find(c => c.offeringId === session.offeringId)!;
    adjacency.set(session.sessionId, new Set(candidate.possibleTimeSlotIds));
  }

  return { sessions, slots, adjacency };
}
