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
  maxSks: number;                // max teaching load in SKS — soft constraint
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
  /**
   * Phase 14 #6: cross-semester / orphan-reference defects detected by the
   * row→domain mapper (`src/repo/mappers/courseOfferingMapper.ts`). The
   * mapper records orphan ids here instead of throwing so a single bad
   * offering rejects as a single Pre-GA `CROSS_SEMESTER_DEFECT` entry
   * (api_design §5.2) rather than killing the worker for the entire run.
   *
   * `checkIntegrity` (`src/pre-ga/checks.ts`) reads this and emits the
   * rejection — the field is intentionally absent when the offering is
   * clean (omitted, not `{}`).
   *
   * `missingCourseId` exists for type-shape symmetry / future-proofing
   * only — at runtime the mapper still throws on a missing course because
   * `CourseOffering.course: Course` is non-optional and the offering
   * would be structurally unrepresentable without it. The slot stays in
   * the type so a future softening of that contract doesn't require a
   * type migration.
   */
  mappingDefects?: {
    missingLecturerIds?: number[];
    missingRoomId?: number | null;
    missingCourseId?: number | null;
  };
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
  /**
   * Phase 14 #6: optional structured payload attached by checks that need to
   * surface richer rejection context (e.g. `CROSS_SEMESTER_DEFECT` carries a
   * `{ field, expectedSemesterId, mismatches, fields }` envelope mirroring
   * Phase 14 #4's `CROSS_SEMESTER_REFERENCE` shape). The orchestrator passes
   * this through to `PreGAInfeasibleEntry.metadata`.
   */
  metadata?: unknown;
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
   * Cohort size carried through from `CourseOffering.effectiveStudentCount`.
   * Phase 11 task #6 uses this in the capacity-shortfall soft penalty:
   * for null-room offerings, the GA penalises chromosomes where the sum of
   * per-session room capacities falls short of this count.
   */
  effectiveStudentCount: number;
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
  /**
   * Phase 15 #1 (OQ-22 cohort aggregation): the full list of constituent
   * offering ids that were merged into this cohort candidate. Length ≥ 1:
   *
   *   - Single-offering cohorts (the legacy case, every fixture pre-Phase-15):
   *     `siblingOfferingIds === [offeringId]`, structurally identical to the
   *     pre-Phase-15 candidate shape.
   *   - Multi-offering cohorts: the primary offering's id is `offeringId`
   *     (lowest id among the siblings); `siblingOfferingIds` lists every
   *     constituent offering id in ascending order, including the primary.
   *
   * Downstream consumers (Phase 15 tasks #2+) use this to derive the cohort's
   * lecturer pool, per-session distribution, and SSA bipartite-graph adjacency.
   */
  siblingOfferingIds: number[];
  /**
   * Phase 15 #2 (OQ-24 / OQ-25 per-session lecturer distribution): union of
   * every sibling offering's `lecturerIds`, deduplicated and sorted ascending
   * for determinism. Single-sibling cohorts: `lecturerPool === lecturerIds`
   * (same set, same order). Multi-sibling cohorts: `lecturerPool` is a
   * superset of `lecturerIds` (the cohort's full lecturer set across all
   * sibling offerings; `lecturerIds` continues to hold only the primary's
   * lecturers — Phase 15 task #11 will eventually pivot SSA off the legacy
   * `lecturerIds` and onto the pool). Task #5's chromosome seeder distributes
   * this pool across the cohort's `parallelSessionCount` sessions per OQ-24's
   * round-robin default.
   */
  lecturerPool: number[];
}

// ─── Layer 2: SSA Types ──────────────────────────────────────────

export interface SessionNode {
  sessionId: number;    // offeringId * 100 + sessionIndex
  offeringId: number;
  sessionIndex: number;
  // note: roomId is null when the offering has no LockedRoom — i.e. the
  // room is a free CSP variable whose domain is `possibleRoomIds`. AC-3
  // must NOT group null-roomId sessions under a single "shared room" key:
  // they don't share a fixed room, they share a domain. The Layer-3 GA is
  // where room collisions are evaluated (via gene.sessions[].roomId, which
  // is guaranteed non-null by the chromosome seeder).
  roomId: number | null;
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
  loadPenalty: number;
  capacityShortfallPenalty: number;
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
 * `NO_ROOMS_QUALIFY`, `NO_FACILITY_MATCH`, `NO_CAPACITY_COMBINATION`.
 *
 * `COMPETENCY_MISMATCH` is per-offering (not a top-level run failure):
 * a run only escalates to `NO_FEASIBLE_CANDIDATES` when **every** offering
 * is rejected. See api_design §5.2.
 */
export interface PreGAInfeasibleEntry {
  offeringId: number;
  code: string;
  message: string;
  /**
   * Phase 14 #6: optional structured payload that survives the orchestrator's
   * `CheckResult` → `PreGAInfeasibleEntry` translation. For
   * `CROSS_SEMESTER_DEFECT` this carries `{ field, expectedSemesterId?,
   * mismatches, fields }` — see api_design §5.2 / Phase 14 #4 for the shape.
   * Adding this field is non-breaking: it is `?: unknown` so the wire
   * contract for clients that ignore it is unchanged.
   */
  metadata?: unknown;
}

export interface SchedulerResponse {
  status: 'SUCCESS' | 'INFEASIBLE' | 'NO_FEASIBLE_CANDIDATES';
  preGASummary: { feasible: number; infeasible: PreGAInfeasibleEntry[] };
  ssaResult?: SSAResult;
  gaResult?: GAResult;
  durationMs: number;
}
