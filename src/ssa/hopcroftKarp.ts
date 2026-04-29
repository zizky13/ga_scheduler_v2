/**
 * SSA — Hopcroft-Karp Maximum Bipartite Matching
 * 
 * Determines whether all sessions can be simultaneously assigned
 * to distinct time slots. If maximumMatching < totalSessions,
 * the problem is PROVABLY INFEASIBLE.
 * 
 * Time Complexity: O(E × √V)
 */

import type { BipartiteGraph, MatchingResult } from '../types.js';

export function runHopcroftKarp(graph: BipartiteGraph): MatchingResult {
  const { sessions, adjacency } = graph;

  const INF = Infinity;

  // matchL[sessionId] = slotId matched to this session (-1 if unmatched)
  const matchL = new Map<number, number>(
    sessions.map(s => [s.sessionId, -1])
  );
  // matchR[slotId] = sessionId matched to this slot (-1 if unmatched)
  const matchR = new Map<number, number>();

  // Initialize all slots as unmatched
  for (const [, slots] of adjacency) {
    for (const slotId of slots) {
      if (!matchR.has(slotId)) {
        matchR.set(slotId, -1);
      }
    }
  }

  // dist[sessionId] = BFS layer distance
  const dist = new Map<number, number>();

  let matching = 0;

  /**
   * BFS phase: finds shortest augmenting path layers.
   */
  function bfs(): boolean {
    const queue: number[] = [];

    for (const session of sessions) {
      if (matchL.get(session.sessionId) === -1) {
        dist.set(session.sessionId, 0);
        queue.push(session.sessionId);
      } else {
        dist.set(session.sessionId, INF);
      }
    }

    let foundAugmenting = false;

    while (queue.length > 0) {
      const sessionId = queue.shift()!;
      const sessionDist = dist.get(sessionId)!;
      const slots = adjacency.get(sessionId) ?? new Set<number>();

      for (const slotId of slots) {
        const pairedSessionId = matchR.get(slotId) ?? -1;

        if (pairedSessionId === -1) {
          foundAugmenting = true;
        } else if (dist.get(pairedSessionId) === INF) {
          dist.set(pairedSessionId, sessionDist + 1);
          queue.push(pairedSessionId);
        }
      }
    }

    return foundAugmenting;
  }

  /**
   * DFS phase: augments along shortest paths found in BFS.
   */
  function dfs(sessionId: number): boolean {
    const slots = adjacency.get(sessionId) ?? new Set<number>();
    const sessionDist = dist.get(sessionId)!;

    for (const slotId of slots) {
      const pairedSessionId = matchR.get(slotId) ?? -1;

      const canAugment =
        pairedSessionId === -1 ||
        (dist.get(pairedSessionId) === sessionDist + 1 && dfs(pairedSessionId));

      if (canAugment) {
        matchL.set(sessionId, slotId);
        matchR.set(slotId, sessionId);
        return true;
      }
    }

    dist.set(sessionId, INF);
    return false;
  }

  // Main Hopcroft-Karp loop
  while (bfs()) {
    for (const session of sessions) {
      if (matchL.get(session.sessionId) === -1) {
        if (dfs(session.sessionId)) {
          matching++;
        }
      }
    }
  }

  const unmatchedSessions = sessions
    .filter(s => matchL.get(s.sessionId) === -1)
    .map(s => s.sessionId);

  return {
    maximumMatching: matching,
    sessionToSlot: matchL,
    slotToSession: matchR,
    unmatchedSessions,
  };
}
