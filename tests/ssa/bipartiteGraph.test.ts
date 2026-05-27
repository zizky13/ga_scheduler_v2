/**
 * SSA — buildBipartiteGraph unit tests (Task 22).
 *
 * Verifies that whole multi-slot contiguous blocks become single matching
 * nodes, so Hopcroft-Karp proves feasibility for chunks rather than isolated
 * slots. Each block's identity is its starting slot id (the first slot of the
 * contiguous chunk), so two sessions competing for the same chunk share a
 * right node.
 */

import { describe, it, expect } from 'vitest';
import { buildBipartiteGraph } from '../../src/ssa/bipartiteGraph.js';
import { runHopcroftKarp } from '../../src/ssa/hopcroftKarp.js';
import { runSSA } from '../../src/ssa/index.js';
import type { PreGACandidate, TimeSlot } from '../../src/types.js';

/** Build N back-to-back 50-min slots starting at 08:00 on the given day. */
function buildDay(day: string, count: number, startId: number): TimeSlot[] {
  const out: TimeSlot[] = [];
  // 50-minute blocks starting from 08:00
  let totalMin = 8 * 60;
  for (let i = 0; i < count; i++) {
    const start = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
    totalMin += 50;
    const end = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
    out.push({ id: startId + i, day, startTime: start, endTime: end });
  }
  return out;
}

function candidate(args: {
  offeringId: number;
  roomId?: number;
  lecturerIds?: number[];
  lecturerPool?: number[];
  siblingOfferingIds?: number[];
  siblingLecturerGroups?: number[][];
  parallelSessionCount?: number;
  sessionDuration: number;
  possibleTimeSlotIds: number[];
  isFixedRoom?: boolean;
}): PreGACandidate {
  const lecturerIds = args.lecturerIds ?? [100];
  return {
    offeringId: args.offeringId,
    courseId: args.offeringId * 10,
    roomId: args.roomId ?? 1,
    lecturerIds,
    effectiveStudentCount: 30,
    parallelSessionCount: args.parallelSessionCount ?? 1,
    sessionDuration: args.sessionDuration,
    possibleTimeSlotIds: args.possibleTimeSlotIds,
    isFixedRoom: args.isFixedRoom ?? false,
    siblingOfferingIds: args.siblingOfferingIds ?? [args.offeringId],
    lecturerPool: args.lecturerPool ?? [...lecturerIds],
    siblingLecturerGroups: args.siblingLecturerGroups ?? [[...lecturerIds]],
  };
}

describe('buildBipartiteGraph — multi-slot block matching nodes', () => {
  it('uses block START slots as right nodes when allTimeSlots is provided', () => {
    // 5 contiguous slots on Monday, 3-SKS course → blocks start at 1, 2, 3.
    const slots = buildDay('Monday', 5, 1);
    const cand = candidate({
      offeringId: 1,
      sessionDuration: 3,
      possibleTimeSlotIds: [1, 2, 3, 4, 5],
    });
    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(1);
    const adj = graph.adjacency.get(graph.sessions[0]!.sessionId)!;
    // Valid block starts: 1 ([1,2,3]), 2 ([2,3,4]), 3 ([3,4,5])
    expect(Array.from(adj).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('falls back to per-slot adjacency when no contiguous block of duration fits', () => {
    // Only 2 contiguous slots, but a 3-SKS course needs 3. The SSA must not
    // over-claim infeasibility — the GA itself relaxes contiguity here, and
    // the SSA's upper bound should match. Adjacency falls back to all
    // possible slots so HK can still find a (looser) feasibility witness.
    const slots = buildDay('Monday', 2, 1);
    const cand = candidate({
      offeringId: 1,
      sessionDuration: 3,
      possibleTimeSlotIds: [1, 2],
    });
    const graph = buildBipartiteGraph([cand], slots);
    expect(Array.from(graph.adjacency.get(graph.sessions[0]!.sessionId)!).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(graph.degradedOfferings).toEqual([1]);
  });

  it('does not stitch blocks across day boundaries (still falls back when no day fits)', () => {
    // 2 slots Monday + 2 slots Tuesday — neither day fits a 3-block.
    // Same fallback as above.
    const slots = [...buildDay('Monday', 2, 1), ...buildDay('Tuesday', 2, 10)];
    const cand = candidate({
      offeringId: 1,
      sessionDuration: 3,
      possibleTimeSlotIds: [1, 2, 10, 11],
    });
    const graph = buildBipartiteGraph([cand], slots);
    expect(Array.from(graph.adjacency.get(graph.sessions[0]!.sessionId)!).sort((a, b) => a - b)).toEqual([1, 2, 10, 11]);
    expect(graph.degradedOfferings).toEqual([1]);
  });

  it('does not cross day boundaries when contiguous blocks DO exist on a single day', () => {
    // 3 contiguous slots on Monday + 2 contiguous slots on Tuesday.
    // Only Monday provides a valid 3-block — Tuesday's adjacency should NOT
    // contribute, because Monday's blocks suffice (no fallback triggered).
    const slots = [...buildDay('Monday', 3, 1), ...buildDay('Tuesday', 2, 10)];
    const cand = candidate({
      offeringId: 1,
      sessionDuration: 3,
      possibleTimeSlotIds: [1, 2, 3, 10, 11],
    });
    const graph = buildBipartiteGraph([cand], slots);
    // Only block start: slot 1 on Monday.
    expect(Array.from(graph.adjacency.get(graph.sessions[0]!.sessionId)!).sort((a, b) => a - b)).toEqual([1]);
    expect(graph.degradedOfferings).toEqual([]);
  });

  it('parallel sessions of the same offering share the block-start adjacency', () => {
    const slots = buildDay('Monday', 4, 1);
    const cand = candidate({
      offeringId: 1,
      sessionDuration: 2,
      parallelSessionCount: 2,
      possibleTimeSlotIds: [1, 2, 3, 4],
    });
    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(2);
    // Block starts in a 4-slot day with duration 2: 1, 2, 3.
    const adj0 = Array.from(graph.adjacency.get(graph.sessions[0]!.sessionId)!).sort((a, b) => a - b);
    const adj1 = Array.from(graph.adjacency.get(graph.sessions[1]!.sessionId)!).sort((a, b) => a - b);
    expect(adj0).toEqual([1, 2, 3]);
    expect(adj1).toEqual([1, 2, 3]);
  });

  it('stamps multi-sibling cohort SessionNodes with the full lecturerPool', () => {
    const slots = buildDay('Monday', 4, 1);
    const cand = candidate({
      offeringId: 20,
      sessionDuration: 2,
      parallelSessionCount: 3,
      possibleTimeSlotIds: [1, 2, 3, 4],
      lecturerIds: [100],
      lecturerPool: [100, 200, 300],
      siblingOfferingIds: [20, 21, 22],
      siblingLecturerGroups: [[100], [200], [300]],
    });

    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(3);
    for (const session of graph.sessions) {
      expect(session.lecturerIds).toEqual([100, 200, 300]);
    }
  });

  it('keeps legacy lecturerIds for single-sibling candidates', () => {
    const slots = buildDay('Monday', 3, 1);
    const cand = candidate({
      offeringId: 30,
      sessionDuration: 1,
      parallelSessionCount: 2,
      possibleTimeSlotIds: [1, 2, 3],
      lecturerIds: [100],
      lecturerPool: [100, 200],
      siblingOfferingIds: [30],
      siblingLecturerGroups: [[100]],
    });

    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(2);
    for (const session of graph.sessions) {
      expect(session.lecturerIds).toEqual([100]);
    }
  });

  it('Hopcroft-Karp proves feasibility for whole chunks, not isolated slots', () => {
    // Old behaviour: 2 sessions × 3 slots [1,2,3] each → HK would have
    // counted 3 right nodes (1, 2, 3) and matched 2 sessions to slots 1 & 2,
    // claiming feasibility. With block matching, each session needs a 3-slot
    // block; only ONE such block ([1,2,3]) exists, so max matching = 1.
    const slots = buildDay('Monday', 3, 1);
    const c1 = candidate({
      offeringId: 1, sessionDuration: 3, possibleTimeSlotIds: [1, 2, 3],
    });
    const c2 = candidate({
      offeringId: 2, sessionDuration: 3, possibleTimeSlotIds: [1, 2, 3],
    });
    const graph = buildBipartiteGraph([c1, c2], slots);
    const m = runHopcroftKarp(graph);
    expect(m.maximumMatching).toBe(1);
    expect(m.unmatchedSessions).toHaveLength(1);
  });

  it('Hopcroft-Karp finds full matching when enough non-overlapping blocks exist', () => {
    // 6 contiguous slots → blocks of duration 3 starting at 1, 2, 3, 4.
    // Two sessions can pick disjoint starts (e.g., 1 and 4 → [1,2,3] vs [4,5,6]).
    const slots = buildDay('Monday', 6, 1);
    const c1 = candidate({
      offeringId: 1, sessionDuration: 3, possibleTimeSlotIds: [1, 2, 3, 4, 5, 6],
    });
    const c2 = candidate({
      offeringId: 2, sessionDuration: 3, possibleTimeSlotIds: [1, 2, 3, 4, 5, 6],
    });
    const graph = buildBipartiteGraph([c1, c2], slots);
    const m = runHopcroftKarp(graph);
    expect(m.maximumMatching).toBe(2);
  });

  it('falls back to per-slot adjacency when allTimeSlots is omitted', () => {
    // Back-compat: no lookup → every possible slot becomes a right node.
    const cand = candidate({
      offeringId: 1, sessionDuration: 1, possibleTimeSlotIds: [10, 20, 30],
    });
    const graph = buildBipartiteGraph([cand]);
    const adj = graph.adjacency.get(graph.sessions[0]!.sessionId)!;
    expect(Array.from(adj).sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('degenerates to per-slot behaviour for sessionDuration === 1 with lookup', () => {
    const slots = buildDay('Monday', 3, 1);
    const cand = candidate({
      offeringId: 1, sessionDuration: 1, possibleTimeSlotIds: [1, 2, 3],
    });
    const graph = buildBipartiteGraph([cand], slots);
    const adj = graph.adjacency.get(graph.sessions[0]!.sessionId)!;
    expect(Array.from(adj).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(graph.degradedOfferings).toEqual([]);
  });

  it('surfaces degraded offerings on SSAResult while preserving FEASIBLE status', () => {
    const slots = buildDay('Monday', 2, 1);
    const cand = candidate({
      offeringId: 42,
      sessionDuration: 3,
      possibleTimeSlotIds: [1, 2],
    });

    const result = runSSA([cand], slots);

    expect(result.status).toBe('FEASIBLE');
    expect(result.maximumAchievableMatching).toBe(1);
    expect(result.degradedOfferings).toEqual([42]);
  });
});

// Phase 15 task #26 — SSA bipartite graph cohort awareness
//
// The bipartite-graph builder stamps `SessionNode.lecturerIds` with the
// cohort's full `lecturerPool` for multi-sibling cohorts (NOT each sibling's
// per-session subset). The SSA proves feasibility under "SOME distribution of
// lecturerPool across sessions"; the GA later picks the specific distribution.
// These tests are the explicit contract for that boundary.
describe('buildBipartiteGraph — Phase 15 #26 cohort SessionNode lecturer stamp', () => {
  it('stamps the full lecturerPool on every sibling session (not the per-session subset)', () => {
    const slots = buildDay('Monday', 4, 1);
    const cand = candidate({
      offeringId: 100,
      sessionDuration: 1,
      parallelSessionCount: 4,
      possibleTimeSlotIds: [1, 2, 3, 4],
      lecturerIds: [10],
      lecturerPool: [10, 20],
      siblingOfferingIds: [100, 200],
      // The GA's seeder would round-robin THESE per-sibling groups across
      // sessions, but the SSA must NOT mirror that — every session keeps
      // the full pool so AC-3 has the full feasibility surface to work with.
      siblingLecturerGroups: [[10], [20]],
    });

    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(4);
    for (const session of graph.sessions) {
      // Negative assertion — explicitly NOT the per-session sibling group.
      expect(session.lecturerIds).not.toEqual([10]);
      expect(session.lecturerIds).not.toEqual([20]);
      // Positive assertion — the full cohort pool.
      expect(session.lecturerIds).toEqual([10, 20]);
    }
  });

  it('stamps the full lecturerPool even when individual siblings team-teach', () => {
    // Two siblings: sibling 0 team-teaches with [10, 11], sibling 1 has [20].
    // lecturerPool unions to [10, 11, 20] (dedup + ascending sort). Every
    // SessionNode must surface the full union; AC-3 propagation will then
    // see e.g. [10, 11, 20] vs another cohort's [10, 11, 20] and only prune
    // when a concrete (room, slot) collision exists.
    const slots = buildDay('Monday', 4, 1);
    const cand = candidate({
      offeringId: 100,
      sessionDuration: 1,
      parallelSessionCount: 4,
      possibleTimeSlotIds: [1, 2, 3, 4],
      lecturerIds: [10, 11],
      lecturerPool: [10, 11, 20],
      siblingOfferingIds: [100, 200],
      siblingLecturerGroups: [[10, 11], [20]],
    });

    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(4);
    for (const session of graph.sessions) {
      expect(session.lecturerIds).toEqual([10, 11, 20]);
    }
  });

  it('keeps the legacy lecturerIds stamp for single-sibling candidates (back-compat)', () => {
    // For a single-offering "cohort", the pre-Phase-15 contract is: SessionNode
    // lecturerIds equals candidate.lecturerIds. The pool happens to be the
    // same set, so this also passes the "stamp the pool" rule trivially.
    const slots = buildDay('Monday', 3, 1);
    const cand = candidate({
      offeringId: 30,
      sessionDuration: 1,
      parallelSessionCount: 2,
      possibleTimeSlotIds: [1, 2, 3],
      lecturerIds: [100, 200], // team-teach on a single offering
      lecturerPool: [100, 200],
      siblingOfferingIds: [30],
      siblingLecturerGroups: [[100, 200]],
    });

    const graph = buildBipartiteGraph([cand], slots);

    expect(graph.sessions).toHaveLength(2);
    for (const session of graph.sessions) {
      expect(session.lecturerIds).toEqual([100, 200]);
    }
  });
});
