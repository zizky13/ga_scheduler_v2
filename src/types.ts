/**
 * Core domain types for the GA Scheduler.
 * These mirror the Prisma schema entities without depending on Prisma.
 */

// ─── Database Entity Types ───────────────────────────────────────

export interface Room {
  id: number;
  name: string;
  capacity: number;
  facilities: string[]; // e.g., ['LAB', 'PROJECTOR']
}

export interface TimeSlot {
  id: number;
  day: string;       // 'Monday', 'Tuesday', ...
  startTime: string; // 'HH:MM'
  endTime: string;   // 'HH:MM'
}

export interface Lecturer {
  id: number;
  name: string;
  isStructural: boolean;         // e.g., department head — soft constraint
  preferredTimeSlotIds: number[]; // slots the lecturer prefers (soft constraint)
  competencies: string[];        // e.g., ['algorithms', 'databases']
}

export interface Course {
  id: number;
  code: string;
  name: string;
  sks: number;       // credit hours
  requiredFacilities: string[]; // e.g., ['LAB']
  requiredCompetencies: string[]; // e.g., ['ai-ml']; empty = no restriction
}

export interface CourseOffering {
  id: number;
  courseId: number;
  course: Course;
  roomId: number | null;
  room: Room | null;
  lecturers: Lecturer[];       // team teaching = multiple
  effectiveStudentCount: number;
  isFixed: boolean;            // pinned by faculty — must not move
  fixedTimeSlotIds?: number[]; // if isFixed, which slots are locked
  parentOfferingId?: number;   // for parallel split offerings
}

/**
 * Manual room-lock applied by the Kaprodi prior to a run (techspec §5.4 / FR-01).
 *
 * Independent of `CourseOffering.isFixed` / `CourseOffering.fixedTimeSlotIds`,
 * which capture *intrinsic* fixedness asserted at data-entry time. Per
 * api_design §3.5, the Pre-GA `entityTagger` (`src/pre-ga/entityTagger.ts`)
 * merges both signals into the final `PreGACandidate.isFixedRoom` — the single
 * source of truth consumed by the GA core. The two sources stay separate at
 * the persistence layer; do not collapse them.
 */
export interface LockedRoom {
  id: number;
  semesterId: number;
  offeringId: number;
  roomId: number;
  lockedById: number;
  lockedAt: Date;
  reason: string | null;
}

// ─── Layer 1: Pre-GA Types ───────────────────────────────────────

export interface CheckResult {
  passed: boolean;
  code: string;
  message: string;
}

export interface PreGAValidationResult {
  feasible: CourseOffering[];
  infeasible: Array<{
    offering: CourseOffering;
    failedCheck: CheckResult;
  }>;
}

export interface PreGACandidate {
  offeringId: number;
  courseId: number;
  roomId: number | null;
  lecturerIds: number[];
  /**
   * Number of parallel groups this offering is split into due to capacity.
   * Formula: ⌈effectiveStudentCount / roomCapacity⌉
   * (backlog task 14/15 — replaces the old `requiredSessions` field).
   */
  parallelSessionCount: number;
  /**
   * Number of consecutive time slots each parallel session occupies.
   * Sourced directly from `course.sks` (1 SKS = 1 time slot / 50 min).
   * A 3-SKS course → sessionDuration = 3 (must be back-to-back, same day).
   */
  sessionDuration: number;
  possibleTimeSlotIds: number[];
  possibleRoomIds?: number[];  // techspec §6.3 / [ARCH-OBS-04] — for FLEXIBLE offerings
  isFixedRoom: boolean; // <-- FIXED
  fixedTimeSlotIds?: number[];
  parentOfferingId?: number; // <-- FIXED
}

// ─── Layer 2: SSA Types ──────────────────────────────────────────

export interface SessionNode {
  sessionId: number;    // offeringId * 100 + sessionIndex
  offeringId: number;
  sessionIndex: number;
  roomId: number;
  lecturerIds: number[];
}

export interface SlotNode {
  slotId: number;
}

export interface BipartiteGraph {
  sessions: SessionNode[];
  slots: SlotNode[];
  adjacency: Map<number, Set<number>>; // sessionId → Set<slotId>
}

export interface AC3Result {
  consistent: boolean;
  emptyDomainSessionId?: number;
  emptyDomainOfferingId?: number;
  reason?: string;
}

export interface MatchingResult {
  maximumMatching: number;
  sessionToSlot: Map<number, number>;
  slotToSession: Map<number, number>;
  unmatchedSessions: number[];
}

export type SSAStatus = 'FEASIBLE' | 'INFEASIBLE';

export interface DeadlockReport {
  code: 'AC3_DOMAIN_EMPTY' | 'BIPARTITE_MATCHING_INSUFFICIENT';
  message: string;
  affectedOfferingIds: number[];
  recommendation: string;
}

export interface SSAResult {
  status: SSAStatus;
  totalSessionsRequired: number;
  maximumAchievableMatching: number;
  deadlockReport?: DeadlockReport;
}

// ─── Layer 3: GA Types ───────────────────────────────────────────

/**
 * One parallel session within a gene.
 * For a 3-SKS course split into 2 parallel groups:
 *   sessions[0] = { roomId: 10, timeSlotIds: [5, 6, 7] }  // group A, Mon 08:00–11:00
 *   sessions[1] = { roomId: 11, timeSlotIds: [5, 6, 7] }  // group B, Mon 08:00–11:00
 */
export interface GeneSession {
  roomId: number;
  timeSlotIds: number[]; // contiguous back-to-back slots, length === sessionDuration
}

export interface FixedRoomGene {
  kind: 'FIXED';
  offeringId: number;
  /**
   * One entry per parallel group (length === parallelSessionCount).
   * roomId on each session is immutable for FIXED genes.
   */
  sessions: GeneSession[];
}

export interface FlexibleGene {
  kind: 'FLEXIBLE';
  offeringId: number;
  /**
   * One entry per parallel group (length === parallelSessionCount).
   * roomId on each session is mutable for FLEXIBLE genes.
   */
  sessions: GeneSession[];
}

export type Gene = FixedRoomGene | FlexibleGene;

export type Chromosome = Gene[];

export interface EvaluatedChromosome {
  chromosome: Chromosome;
  fitness: number;
  hardViolations: number;
  softPenalty: number;
  structuralPenalty: number;
  preferencePenalty: number;
  competencyMismatch: number;
}

export interface GAConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  elitismCount: number;
  tournamentSize: number;
  crossoverType: 'singlePoint' | 'uniform' | 'pmx';
  noiseRate: number;
  hardPenaltyWeight: number;   // W_H — techspec §4.3 default 100
  softPenaltyWeight: number;   // W_S — techspec §4.3 default 1
  /**
   * **DEBUG-ONLY. NEVER EXPOSE THROUGH A USER-FACING SURFACE.**
   *
   * (a) **Purpose.** Exists solely to support the SSA ablation experiment
   *     under `src/experiments/` (see `docs/backlog_experiment.md` Phase E0
   *     and `docs/experiments/ssa-ablation-report.md`). The flag is the
   *     independent variable of that study and has no production use case.
   * (b) **Firewall.** MUST NOT be wired into any user-facing surface:
   *     REST API Zod schemas under `src/api/schemas/*` (the
   *     `/schedule-runs` request body schema must reject this field via
   *     `.strict()` or an explicit allowlist), frontend forms, or any
   *     other API consumer. Only the experiment harness
   *     (`src/experiments/ssa-ablation.ts`) and the dedicated CLI flag
   *     `--skip-ssa` are authorised callers. Phase E5 of
   *     `docs/backlog_experiment.md` enforces this in code and tests.
   * (c) **Production default.** All production callers leave this unset
   *     (`undefined`) or explicitly set it to `false`. Setting `true`
   *     skips the entire SSA layer in `src/orchestrator.ts` and feeds
   *     Pre-GA candidates straight to the GA — on structurally infeasible
   *     inputs the GA returns `status === 'SUCCESS'` with unresolved hard
   *     constraint violations (see §4.4 of the ablation report). That is
   *     not a safe production failure mode.
   */
  skipSSA?: boolean;
}

export interface GAResult {
  bestChromosome: Chromosome;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  history: number[];
  avgHistory: number[];
  stagnatedEarly: boolean;
  generationsRun: number;
}

// ─── Orchestration Types ─────────────────────────────────────────

/**
 * One per-offering rejection record produced by Pre-GA. Surfaced to the API
 * consumer as part of `SchedulerResponse.preGASummary.infeasible[]`
 * (api_design §5.2). The `code` is one of the stable Pre-GA failure codes
 * emitted by `src/pre-ga/checks.ts` / `src/pre-ga/validator.ts` —
 * `INTEGRITY_NO_COURSE`, `INTEGRITY_NO_ROOM`, `INTEGRITY_NO_LECTURERS`,
 * `INTEGRITY_NO_STUDENTS`, `ROOM_MISSING`, `ROOM_ZERO_CAPACITY`,
 * `TEMPORAL_INSUFFICIENT`, `FACILITY_MISMATCH`, `LECTURER_NONE`,
 * `LECTURER_INVALID`, `COMPETENCY_MISMATCH`, `POLICY_FIXED_NO_SLOTS`,
 * `NO_ROOMS_QUALIFY`.
 *
 * `COMPETENCY_MISMATCH` is per-offering (not a top-level run failure):
 * a run only escalates to `NO_FEASIBLE_CANDIDATES` when **every** offering
 * is rejected. See api_design §5.2.
 */
export interface PreGAInfeasibleEntry {
  offeringId: number;
  code: string;
  message: string;
}

export interface SchedulerResponse {
  status: 'SUCCESS' | 'INFEASIBLE' | 'NO_FEASIBLE_CANDIDATES';
  preGASummary: { feasible: number; infeasible: PreGAInfeasibleEntry[] };
  ssaResult?: SSAResult;
  /**
   * **DEBUG-ONLY TELEMETRY. NEVER EXPOSE THROUGH A USER-FACING SURFACE.**
   *
   * (a) **Purpose.** Reports whether SSA was bypassed via
   *     `GAConfig.skipSSA` on this run. Consumed by the SSA ablation
   *     harness in `src/experiments/ssa-ablation.ts` to verify that the
   *     orchestrator honoured the configured mode; no production code
   *     path branches on this field.
   * (b) **Firewall.** MUST NOT be surfaced in REST API responses or
   *     rendered in the frontend. The presence of this field on
   *     `SchedulerResponse` is an internal contract between the
   *     orchestrator and the experiment harness; API response schemas
   *     must strip it before serialisation.
   * (c) **Production default.** Always `false` on canonical pipeline
   *     runs (`GAConfig.skipSSA` undefined or `false`). A `true` value
   *     in a production log indicates an unauthorised debug toggle.
   */
  ssaSkipped: boolean;
  gaResult?: GAResult;
  durationMs: number;
  /**
   * **DEBUG-ONLY TELEMETRY. NEVER EXPOSE THROUGH A USER-FACING SURFACE.**
   *
   * (a) **Purpose.** Per-phase wall-clock split of `durationMs`,
   *     instrumented by E1 task 8 of `docs/backlog_experiment.md` to
   *     support the SSA ablation experiment. The harness in
   *     `src/experiments/ssa-ablation.ts` aggregates these into the
   *     per-scenario duration tables in
   *     `docs/experiments/ssa-ablation-report.md` §4. No production code
   *     path branches on any of the three fields.
   * (b) **Firewall.** MUST NOT be returned by the public REST API
   *     (`/schedule-runs`) or rendered in the frontend. API response
   *     schemas must strip these fields before serialisation; the public
   *     contract for run duration is the aggregate `durationMs`.
   * (c) **Production default.** All three fields are populated by
   *     `runPipeline` on every run (the layer that did not execute
   *     reports `0`). Their sum equals `durationMs` within ±1ms rounding
   *     error (each field is independently `Math.round`-ed).
   *     `ssaDurationMs` is `0` when `ssaSkipped === true` AND when the
   *     run aborted with `NO_FEASIBLE_CANDIDATES` before SSA could run.
   *     `gaDurationMs` is `0` when SSA returned `INFEASIBLE` or when the
   *     run aborted with `NO_FEASIBLE_CANDIDATES`.
   *
   * Optional on the interface so older code paths or test fixtures that
   * construct a `SchedulerResponse` literal without timing instrumentation
   * still compile; runtime callers from `runPipeline` always populate them.
   */
  preGADurationMs?: number;
  ssaDurationMs?: number;
  gaDurationMs?: number;
}
