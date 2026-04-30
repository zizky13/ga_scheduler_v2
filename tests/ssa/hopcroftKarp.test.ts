/**
 * Layer 2 (SSA Phase 2) — Hopcroft-Karp maximum bipartite matching unit tests.
 *
 * Mirrors the test outline in techspec §10.1:
 *   ├── Returns perfect matching when one exists (n sessions, n unique slots)
 *   ├── Returns maximumMatching < n when n sessions compete for n-1 slots
 *   ├── Correctly identifies unmatchedSessions[] for error reporting
 *   └── Handles empty adjacency (domain-less session) gracefully
 */

import { describe, it, expect } from 'vitest';
import { runHopcroftKarp } from '../../src/ssa/hopcroftKarp.js';
import type { BipartiteGraph, SessionNode } from '../../src/types.js';

interface SessionSpec {
  sessionId: number;
  offeringId?: number;
  sessionIndex?: number;
  roomId?: number;
  lecturerIds?: number[];
  domain: number[];
}

function buildGraph(specs: SessionSpec[]): BipartiteGraph {
  const sessions: SessionNode[] = specs.map(s => ({
    sessionId: s.sessionId,
    offeringId: s.offeringId ?? s.sessionId,
    sessionIndex: s.sessionIndex ?? 0,
    roomId: s.roomId ?? 1,
    lecturerIds: s.lecturerIds ?? [1],
  }));
  const adjacency = new Map<number, Set<number>>(
    specs.map(s => [s.sessionId, new Set(s.domain)])
  );
  const slotIds = new Set<number>();
  for (const s of specs) for (const slot of s.domain) slotIds.add(slot);
  const slots = Array.from(slotIds).map(id => ({ slotId: id }));
  return { sessions, slots, adjacency };
}

describe('runHopcroftKarp (techspec §10.1)', () => {
  it('returns perfect matching when one exists (n sessions, n unique slots)', () => {
    // 3 sessions, each with a unique exclusive slot.
    const graph = buildGraph([
      { sessionId: 1, domain: [10] },
      { sessionId: 2, domain: [20] },
      { sessionId: 3, domain: [30] },
    ]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(3);
    expect(result.unmatchedSessions).toEqual([]);
    expect(result.sessionToSlot.get(1)).toBe(10);
    expect(result.sessionToSlot.get(2)).toBe(20);
    expect(result.sessionToSlot.get(3)).toBe(30);
  });

  it('returns perfect matching with overlapping domains when one is achievable', () => {
    // Classic 3x3 with full overlap — n! valid matchings.
    const graph = buildGraph([
      { sessionId: 1, domain: [10, 20, 30] },
      { sessionId: 2, domain: [10, 20, 30] },
      { sessionId: 3, domain: [10, 20, 30] },
    ]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(3);
    expect(result.unmatchedSessions).toEqual([]);

    // Each matched slot must be in that session's domain.
    for (const session of graph.sessions) {
      const slot = result.sessionToSlot.get(session.sessionId);
      expect(slot).not.toBe(-1);
      expect(graph.adjacency.get(session.sessionId)!.has(slot!)).toBe(true);
    }
    // Bijection: distinct slots assigned to distinct sessions.
    const assignedSlots = graph.sessions.map(s => result.sessionToSlot.get(s.sessionId));
    expect(new Set(assignedSlots).size).toBe(graph.sessions.length);
  });

  it('returns maximumMatching < n when n sessions compete for n-1 slots', () => {
    // 3 sessions, 2 distinct slots — maximum matching is 2.
    const graph = buildGraph([
      { sessionId: 1, domain: [10, 20] },
      { sessionId: 2, domain: [10, 20] },
      { sessionId: 3, domain: [10, 20] },
    ]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(2);
    expect(result.maximumMatching).toBeLessThan(graph.sessions.length);
    expect(result.unmatchedSessions).toHaveLength(1);
  });

  it('correctly identifies unmatchedSessions[] for error reporting', () => {
    // Session 99 has no slots in common with the available {10, 20}.
    const graph = buildGraph([
      { sessionId: 1, domain: [10] },
      { sessionId: 2, domain: [20] },
      { sessionId: 99, domain: [10, 20] },
    ]);

    const result = runHopcroftKarp(graph);

    // Sessions 1 and 2 are forced to 10 and 20, leaving 99 orphaned.
    expect(result.maximumMatching).toBe(2);
    expect(result.unmatchedSessions).toEqual([99]);
    expect(result.sessionToSlot.get(99)).toBe(-1);
  });

  it('handles empty adjacency (domain-less session) gracefully', () => {
    const graph = buildGraph([
      { sessionId: 1, domain: [10] },
      { sessionId: 7, domain: [] }, // domain-less
    ]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(1);
    expect(result.unmatchedSessions).toEqual([7]);
    expect(result.sessionToSlot.get(7)).toBe(-1);
    expect(result.sessionToSlot.get(1)).toBe(10);
  });

  it('handles empty graph gracefully', () => {
    const graph: BipartiteGraph = { sessions: [], slots: [], adjacency: new Map() };

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(0);
    expect(result.unmatchedSessions).toEqual([]);
  });

  it('returns matching of 1 for a single session with non-empty domain', () => {
    const graph = buildGraph([{ sessionId: 1, domain: [10, 20] }]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(1);
    expect(result.unmatchedSessions).toEqual([]);
    expect([10, 20]).toContain(result.sessionToSlot.get(1)!);
  });

  it('augments through a chain when greedy assignment would fail', () => {
    // Session 1 prefers slot 10 (only option for 1).
    // Session 2 also wants slot 10, but can fall back to slot 20.
    // Session 3 also wants slot 20, but can fall back to slot 30.
    // A naïve greedy starting from session 2 might grab slot 10,
    // forcing session 1 unmatched. Hopcroft-Karp must augment to find
    // the perfect matching: 1→10, 2→20, 3→30.
    const graph = buildGraph([
      { sessionId: 1, domain: [10] },
      { sessionId: 2, domain: [10, 20] },
      { sessionId: 3, domain: [20, 30] },
    ]);

    const result = runHopcroftKarp(graph);

    expect(result.maximumMatching).toBe(3);
    expect(result.unmatchedSessions).toEqual([]);
    expect(result.sessionToSlot.get(1)).toBe(10);
    expect([10, 20]).toContain(result.sessionToSlot.get(2)!);
    expect([20, 30]).toContain(result.sessionToSlot.get(3)!);
    // Bijection invariant.
    const assigned = [
      result.sessionToSlot.get(1),
      result.sessionToSlot.get(2),
      result.sessionToSlot.get(3),
    ];
    expect(new Set(assigned).size).toBe(3);
  });
});
