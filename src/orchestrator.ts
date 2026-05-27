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
  LockedRoom,
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
  // Phase 10 #6c: the LockedRoom DB rows for this run's semester. When
  // provided, they become the single source of truth for room locks —
  // runPreGA receives a map built from these rows and ignores the legacy
  // `CourseOffering.{isFixed, roomId}` in-process proxy. CLI callers and
  // tests omit this; the legacy proxy is preserved for backward compat.
  lockedRooms?: LockedRoom[];
}

export interface OrchestratorContext {
  validation: PreGAValidationResult;
  candidates: PreGACandidate[];
  ssaResult?: SSAResult;
  lecturerStructuralMap: Map<number, boolean>;
  lecturerPreferenceMap: Map<number, Set<number>>;
  lecturerMaxSksMap: Map<number, number>;
  competencyEligibilityMap: Map<number, Set<number>>;
}

export interface OrchestratorOutput {
  response: SchedulerResponse;
  context: OrchestratorContext;
}

export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { offerings, timeSlots, rooms, lecturers, config, hooks, lockedRooms } = input;
  const start = performance.now();

  // Phase 10 #6c: build the lockedRoomMap from the caller-supplied LockedRoom
  // rows when present. `undefined` means "no DB-sourced locks provided" and
  // runPreGA falls back to the legacy in-process proxy.
  const lockedRoomMap: ReadonlyMap<number, number> | undefined = lockedRooms
    ? new Map(lockedRooms.map(lr => [lr.offeringId, lr.roomId]))
    : undefined;

  const lecturerStructuralMap = new Map<number, boolean>(
    lecturers.map(l => [l.id, l.isStructural])
  );
  const lecturerPreferenceMap = new Map<number, Set<number>>(
    lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
  );
  const lecturerMaxSksMap = new Map<number, number>(
    lecturers.map(l => [l.id, l.maxSks])
  );

  const { validation, candidates } = runPreGA(offerings, timeSlots, rooms, lockedRoomMap);

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
  // Phase 14 #6: pass through `failedCheck.metadata` when present so the
  // `CROSS_SEMESTER_DEFECT` envelope reaches the wire intact.
  //
  // Phase 16 #2: `warnings[]` parallels `infeasible[]` for soft visibility
  // signals — currently only `FRAGMENTATION_REQUIRED` (timetable's longest
  // contiguous run is shorter than the offering's `sessionDuration`, so the
  // GA will fragment the session and emit `fragmentationPenalty` per #6).
  // The candidates stay in `feasible`, the run proceeds — this channel is
  // for the Run Detail / Timetable Management panels (#13/#14/#15).
  const preGASummary = {
    feasible: validation.feasible.length,
    infeasible: validation.infeasible.map(({ offering, failedCheck }) => ({
      offeringId: offering.id,
      code: failedCheck.code,
      message: failedCheck.message,
      ...(failedCheck.metadata !== undefined ? { metadata: failedCheck.metadata } : {}),
    })),
    warnings: candidates
      .filter(c => c.fragmentationRequired === true)
      .map(c => ({
        offeringId: c.offeringId,
        code: 'FRAGMENTATION_REQUIRED',
        message:
          `Offering ${c.offeringId} requires a ${c.sessionDuration}-slot ` +
          `contiguous session but the timetable's longest run for this ` +
          `candidate is ${c.longestContiguousRun} slot(s). The session ` +
          `will be fragmented across in-day breaks (soft penalty applied).`,
        fragmentationRequired: true,
        longestContiguousRun: c.longestContiguousRun,
        sessionDuration: c.sessionDuration,
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
        lecturerMaxSksMap,
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
        lecturerMaxSksMap,
        competencyEligibilityMap,
      },
    };
  }

  // Phase 11 task #6 — supply roomById so the GA fitness function can
  // compute the capacity-shortfall soft penalty for null-room offerings.
  const roomById: ReadonlyMap<number, Room> = new Map(rooms.map(r => [r.id, r]));

  const gaResult = await runGA(
    candidates,
    lecturerStructuralMap,
    lecturerPreferenceMap,
    lecturerMaxSksMap,
    config,
    competencyEligibilityMap,
    timeSlots,
    hooks,
    roomById,
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
      lecturerMaxSksMap,
      competencyEligibilityMap,
    },
  };
}
