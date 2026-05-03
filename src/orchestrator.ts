/**
 * Pipeline Orchestrator — pure runPreGA → runSSA → runGA composition.
 *
 * Returns a SchedulerResponse envelope (see src/types.ts) so both the CLI
 * runners and the future HTTP API layer can share a single entry point.
 * No console.log, no process.exit — only the GA core's own progress logging
 * (originating from src/ga/runGA.ts) leaks through, which the CLI suppresses
 * or surfaces as it sees fit.
 */

import type {
  CourseOffering,
  GAConfig,
  Lecturer,
  PreGACandidate,
  PreGAValidationResult,
  Room,
  SchedulerResponse,
  SSAResult,
  TimeSlot,
} from './types.js';
import { runPreGA } from './pre-ga/validator.js';
import { isLecturerEligibleForCourse } from './pre-ga/checks.js';
import { runSSA } from './ssa/index.js';
import { runGA } from './ga/runGA.js';

export interface OrchestratorInput {
  offerings: CourseOffering[];
  timeSlots: TimeSlot[];
  rooms: Room[];
  lecturers: Lecturer[];
  config: GAConfig;
}

export interface OrchestratorContext {
  validation: PreGAValidationResult;
  candidates: PreGACandidate[];
  ssaResult?: SSAResult;
  lecturerStructuralMap: Map<number, boolean>;
  lecturerPreferenceMap: Map<number, Set<number>>;
  competencyEligibilityMap: Map<number, Set<number>>;
}

export interface OrchestratorOutput {
  response: SchedulerResponse;
  context: OrchestratorContext;
}

export function runPipeline(input: OrchestratorInput): OrchestratorOutput {
  const { offerings, timeSlots, rooms, lecturers, config } = input;
  const start = performance.now();

  const lecturerStructuralMap = new Map<number, boolean>(
    lecturers.map(l => [l.id, l.isStructural])
  );
  const lecturerPreferenceMap = new Map<number, Set<number>>(
    lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
  );

  const { validation, candidates } = runPreGA(offerings, timeSlots, rooms);

  const competencyEligibilityMap = new Map<number, Set<number>>(
    validation.feasible.map(o => [
      o.id,
      new Set(
        lecturers.filter(l => isLecturerEligibleForCourse(l, o.course)).map(l => l.id)
      ),
    ])
  );

  // api_design §5.2: `infeasible` is an array of per-offering rejection
  // records (not a count). `COMPETENCY_MISMATCH` and any other Layer 1
  // reason surface here; the run only escalates to top-level
  // `NO_FEASIBLE_CANDIDATES` when `validation.feasible` is empty.
  const preGASummary = {
    feasible: validation.feasible.length,
    infeasible: validation.infeasible.map(({ offering, failedCheck }) => ({
      offeringId: offering.id,
      code: failedCheck.code,
      message: failedCheck.message,
    })),
  };

  if (candidates.length === 0) {
    return {
      response: {
        status: 'NO_FEASIBLE_CANDIDATES',
        preGASummary,
        durationMs: Math.round(performance.now() - start),
      },
      context: {
        validation,
        candidates,
        lecturerStructuralMap,
        lecturerPreferenceMap,
        competencyEligibilityMap,
      },
    };
  }

  const ssaResult = runSSA(candidates);

  if (ssaResult.status === 'INFEASIBLE') {
    return {
      response: {
        status: 'INFEASIBLE',
        preGASummary,
        ssaResult,
        durationMs: Math.round(performance.now() - start),
      },
      context: {
        validation,
        candidates,
        ssaResult,
        lecturerStructuralMap,
        lecturerPreferenceMap,
        competencyEligibilityMap,
      },
    };
  }

  const gaResult = runGA(
    candidates,
    lecturerStructuralMap,
    lecturerPreferenceMap,
    config,
    competencyEligibilityMap
  );

  return {
    response: {
      status: 'SUCCESS',
      preGASummary,
      ssaResult,
      gaResult,
      durationMs: Math.round(performance.now() - start),
    },
    context: {
      validation,
      candidates,
      ssaResult,
      lecturerStructuralMap,
      lecturerPreferenceMap,
      competencyEligibilityMap,
    },
  };
}
