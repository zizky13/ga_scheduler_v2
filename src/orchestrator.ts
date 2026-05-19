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
import { runGA, type GAHooks } from './ga/runGA.js';

export interface OrchestratorInput {
  offerings: CourseOffering[];
  timeSlots: TimeSlot[];
  rooms: Room[];
  lecturers: Lecturer[];
  config: GAConfig;
  hooks?: GAHooks;
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

export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { offerings, timeSlots, rooms, lecturers, config, hooks } = input;
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

  /*
   * Experimental SSA bypass — see GAConfig.skipSSA JSDoc and
   * docs/backlog_experiment.md Phase E0. The bypass omits ssaResult from
   * the response so consumers can detect it (further enhanced by E0.3).
   */
  if (config.skipSSA === true) {
    const gaResult = await runGA(
      candidates,
      lecturerStructuralMap,
      lecturerPreferenceMap,
      config,
      competencyEligibilityMap,
      timeSlots,
      hooks
    );

    return {
      response: {
        status: 'SUCCESS',
        preGASummary,
        ssaResult: undefined,
        gaResult,
        durationMs: Math.round(performance.now() - start),
      },
      context: {
        validation,
        candidates,
        ssaResult: undefined,
        lecturerStructuralMap,
        lecturerPreferenceMap,
        competencyEligibilityMap,
      },
    };
  }

  const ssaResult = runSSA(candidates, timeSlots);

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

  const gaResult = await runGA(
    candidates,
    lecturerStructuralMap,
    lecturerPreferenceMap,
    config,
    competencyEligibilityMap,
    timeSlots,
    hooks
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
