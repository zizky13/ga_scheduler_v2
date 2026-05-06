/**
 * SSA Orchestrator — Layer 2 Entry Point
 *
 * Runs the three-phase Static Structural Analysis:
 *   Phase 0: Static Exclusion — lock Fixed Room coordinates, prune Flexible domains
 *   Phase 1: AC-3 constraint propagation
 *   Phase 2: Hopcroft-Karp maximum matching
 */

import type { PreGACandidate, SSAResult, TimeSlot, DeadlockReport } from '../types.js';
import { runStaticExclusion } from './staticExclusion.js';
import { buildBipartiteGraph } from './bipartiteGraph.js';
import { runAC3 } from './ac3.js';
import { runHopcroftKarp } from './hopcroftKarp.js';

/**
 * Pass `allTimeSlots` so the bipartite graph can map whole multi-slot blocks
 * (one node per `sessionDuration`-length contiguous chunk) instead of isolated
 * slots — see `buildBipartiteGraph`. Omitting it preserves the legacy per-slot
 * behaviour, which is only correct when every candidate has duration 1.
 */
export function runSSA(
  candidates: PreGACandidate[],
  allTimeSlots?: TimeSlot[]
): SSAResult {
  const totalSessionsRequired = candidates.reduce(
    (sum, c) => sum + c.parallelSessionCount, 0
  );

  // Phase 0: Static Exclusion — prune locked coordinates from flexible domains
  const { prunedCandidates } = runStaticExclusion(candidates);

  // Phase 1: Build bipartite graph from pruned candidates
  const graph = buildBipartiteGraph(prunedCandidates, allTimeSlots);

  // Phase 1 (AC-3): constraint propagation — domain reduction
  const ac3Result = runAC3(graph);

  if (!ac3Result.consistent) {
    return {
      status: 'INFEASIBLE',
      totalSessionsRequired,
      maximumAchievableMatching: 0,
      deadlockReport: {
        code: 'AC3_DOMAIN_EMPTY',
        message: ac3Result.reason ?? 'Domain became empty during constraint propagation.',
        affectedOfferingIds: ac3Result.emptyDomainOfferingId
          ? [ac3Result.emptyDomainOfferingId]
          : [],
        recommendation:
          'Add more time slots or reduce the number of courses assigned to ' +
          'this lecturer/room combination.',
      },
    };
  }

  // Phase 2 (Hopcroft-Karp): maximum bipartite matching — global feasibility proof
  const matchingResult = runHopcroftKarp(graph);

  if (matchingResult.maximumMatching < totalSessionsRequired) {
    const unmatchedOfferingIds = [
      ...new Set(
        matchingResult.unmatchedSessions.map(sessionId =>
          Math.floor(sessionId / 100)
        )
      ),
    ];

    return {
      status: 'INFEASIBLE',
      totalSessionsRequired,
      maximumAchievableMatching: matchingResult.maximumMatching,
      deadlockReport: {
        code: 'BIPARTITE_MATCHING_INSUFFICIENT',
        message:
          `Structural infeasibility: ${totalSessionsRequired} sessions ` +
          `require scheduling, but only ${matchingResult.maximumMatching} can be ` +
          `simultaneously assigned. ` +
          `${totalSessionsRequired - matchingResult.maximumMatching} session(s) orphaned.`,
        affectedOfferingIds: unmatchedOfferingIds,
        recommendation:
          'Consider: (1) adding more time slots, ' +
          '(2) reducing concurrent course offerings, or ' +
          '(3) splitting team-taught courses across different lecturers.',
      },
    };
  }

  return {
    status: 'FEASIBLE',
    totalSessionsRequired,
    maximumAchievableMatching: matchingResult.maximumMatching,
  };
}
