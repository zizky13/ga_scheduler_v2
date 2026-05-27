/**
 * Layer 2 (SSA Phase 1) — AC-3 constraint propagation unit tests.
 *
 * Mirrors the test outline in techspec §10.1:
 *   ├── Detects empty domain: two sessions in same room, both domain = [slot_1]
 *   ├── Propagates correctly: session A domain [1,2], session B domain [1] → A domain [2]
 *   ├── Returns consistent: true when sessions share room but non-overlapping domains
 *   └── Handles team-teaching: lecturer conflict pruned same as room conflict
 */

import { describe, it, expect } from 'vitest';
import { runAC3 } from '../../src/ssa/ac3.js';
import type { BipartiteGraph, SessionNode } from '../../src/types.js';

interface SessionSpec {
  sessionId: number;
  offeringId: number;
  sessionIndex?: number;
  roomId: number | null;
  lecturerIds: number[];
  domain: number[];
}

function buildGraph(specs: SessionSpec[]): BipartiteGraph {
  const sessions: SessionNode[] = specs.map(s => ({
    sessionId: s.sessionId,
    offeringId: s.offeringId,
    sessionIndex: s.sessionIndex ?? 0,
    roomId: s.roomId,
    lecturerIds: s.lecturerIds,
  }));
  const adjacency = new Map<number, Set<number>>(
    specs.map(s => [s.sessionId, new Set(s.domain)])
  );
  const slotIds = new Set<number>();
  for (const s of specs) for (const slot of s.domain) slotIds.add(slot);
  const slots = Array.from(slotIds).map(id => ({ slotId: id }));
  return { sessions, slots, adjacency };
}

describe('runAC3 (techspec §10.1)', () => {
  it('detects empty domain: two sessions in same room, both domain = [slot_1]', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1] },
      { sessionId: 2, offeringId: 2, roomId: 10, lecturerIds: [200], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(false);
    expect(result.emptyDomainSessionId).toBeDefined();
    expect([1, 2]).toContain(result.emptyDomainSessionId);
    expect([1, 2]).toContain(result.emptyDomainOfferingId);
    expect(result.reason).toContain('TEMPORAL_DEADLOCK');
  });

  it('propagates correctly: session A domain [1,2], session B domain [1] → A domain [2]', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1, 2] },
      { sessionId: 2, offeringId: 2, roomId: 10, lecturerIds: [200], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(1)!).sort()).toEqual([2]);
    expect(Array.from(graph.adjacency.get(2)!).sort()).toEqual([1]);
  });

  it('returns consistent: true when sessions share room but have non-overlapping domains', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1, 2] },
      { sessionId: 2, offeringId: 2, roomId: 10, lecturerIds: [200], domain: [3, 4] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(1)!).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(Array.from(graph.adjacency.get(2)!).sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it('handles team-teaching: lecturer conflict pruned same as room conflict', () => {
    // Different rooms, but sessions share a lecturer (id 500). Both forced to slot 1.
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [500], domain: [1] },
      { sessionId: 2, offeringId: 2, roomId: 20, lecturerIds: [500], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(false);
    expect([1, 2]).toContain(result.emptyDomainSessionId);
    expect(result.reason).toContain('TEMPORAL_DEADLOCK');
  });

  it('propagates lecturer conflict across rooms: A=[1,2], B=[1] sharing lecturer → A=[2]', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [500], domain: [1, 2] },
      { sessionId: 2, offeringId: 2, roomId: 20, lecturerIds: [500], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(1)!).sort()).toEqual([2]);
    expect(Array.from(graph.adjacency.get(2)!).sort()).toEqual([1]);
  });

  it('returns consistent: true when sessions share neither room nor lecturer', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1] },
      { sessionId: 2, offeringId: 2, roomId: 20, lecturerIds: [200], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(1)!)).toEqual([1]);
    expect(Array.from(graph.adjacency.get(2)!)).toEqual([1]);
  });

  it('handles single-session graph (no constraints to propagate)', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1, 2, 3] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(1)!).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('handles empty graph gracefully', () => {
    const graph: BipartiteGraph = { sessions: [], slots: [], adjacency: new Map() };
    const result = runAC3(graph);
    expect(result.consistent).toBe(true);
  });

  it('does NOT propagate shared-lecturer constraint between sibling sessions (Phase 15 OQ-26)', () => {
    // Two sibling sessions of the SAME cohort — different sessionIndex, both
    // roomId=null (per-session room decided post-SSA), sharing the same
    // lecturerPool. Phase 15 moves per-session lecturer distribution to the
    // GA, so AC-3 must not prune slot 1 from sibling A just because sibling B
    // is forced to slot 1. The null roomIds also must not introduce a
    // spurious shared-room constraint.
    const graph = buildGraph([
      { sessionId: 100, offeringId: 1, sessionIndex: 0, roomId: null, lecturerIds: [500], domain: [1, 2] },
      { sessionId: 101, offeringId: 1, sessionIndex: 1, roomId: null, lecturerIds: [500], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(100)!).sort()).toEqual([1, 2]);
    expect(Array.from(graph.adjacency.get(101)!).sort()).toEqual([1]);
  });

  it('still propagates shared-lecturer constraints across different cohorts', () => {
    const graph = buildGraph([
      { sessionId: 300, offeringId: 3, sessionIndex: 0, roomId: null, lecturerIds: [500], domain: [1, 2] },
      { sessionId: 400, offeringId: 4, sessionIndex: 0, roomId: null, lecturerIds: [500], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(300)!).sort()).toEqual([2]);
    expect(Array.from(graph.adjacency.get(400)!).sort()).toEqual([1]);
  });

  it('does NOT add shared-room constraint between null-room siblings (Phase 11 task #10)', () => {
    // Two sibling sessions of the same null-room offering with DIFFERENT
    // lecturers and both forced to slot 1. With no shared room or shared
    // lecturer, AC-3 must not propagate any constraint — both keep [1].
    const graph = buildGraph([
      { sessionId: 200, offeringId: 2, sessionIndex: 0, roomId: null, lecturerIds: [600], domain: [1] },
      { sessionId: 201, offeringId: 2, sessionIndex: 1, roomId: null, lecturerIds: [700], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    expect(Array.from(graph.adjacency.get(200)!)).toEqual([1]);
    expect(Array.from(graph.adjacency.get(201)!)).toEqual([1]);
  });

  it('chains propagation: A=[1,2,3], B=[1,2], C=[1] in same room → A=[3], B=[2], C=[1]', () => {
    const graph = buildGraph([
      { sessionId: 1, offeringId: 1, roomId: 10, lecturerIds: [100], domain: [1, 2, 3] },
      { sessionId: 2, offeringId: 2, roomId: 10, lecturerIds: [200], domain: [1, 2] },
      { sessionId: 3, offeringId: 3, roomId: 10, lecturerIds: [300], domain: [1] },
    ]);

    const result = runAC3(graph);

    expect(result.consistent).toBe(true);
    // C is forced to slot 1, so B can no longer use 1 → B = [2].
    // Then B is forced to slot 2, so A can no longer use 2 → A = [3] (and A can't use 1 either).
    expect(Array.from(graph.adjacency.get(3)!)).toEqual([1]);
    expect(Array.from(graph.adjacency.get(2)!).sort()).toEqual([2]);
    expect(Array.from(graph.adjacency.get(1)!).sort()).toEqual([3]);
  });
});
