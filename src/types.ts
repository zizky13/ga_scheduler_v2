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
  /**
   * Phase 15 #5 (OQ-24 / OQ-25 team-teach preservation): per-sibling lecturer
   * arrays, parallel to `siblingOfferingIds` (`siblingLecturerGroups[i]` is the
   * lecturer-id list owned by `siblingOfferingIds[i]`, each sorted ascending).
   * The chromosome seeder distributes sessions across siblings round-robin
   * (`sessions[i].lecturerIds = siblingLecturerGroups[i % length]`) so a
   * sibling team-teaching with multiple lecturers keeps its full lecturer list
   * on every session that sibling "owns". Single-sibling cohorts have
   * `siblingLecturerGroups.length === 1` and `siblingLecturerGroups[0]`
   * equivalent (as a set) to `lecturerIds`.
   */
  siblingLecturerGroups: number[][];
  /**
   * Phase 16 #1 (OQ-32 / OQ-33): the longest run of strictly back-to-back
   * timeslots found in `possibleTimeSlotIds`, computed per-day (`slots[i].endTime
   * === slots[i+1].startTime`, OQ-32 strict-equality default) and reduced via
   * `max(perDayLongestRun)`. Captures the candidate's wall-clock topology so
   * downstream consumers can decide whether a session can fit contiguously.
   * Cross-day runs are never considered contiguous (OQ-33 default — sessions
   * never span days).
   */
  longestContiguousRun: number;
  /**
   * Phase 16 #1 (Q3=B best-effort visibility): stamped `true` when
   * `longestContiguousRun < sessionDuration` — the timetable cannot hold the
   * cohort's session as a single contiguous run on any single day, so the GA
   * will be forced to fragment the session across one or more in-day breaks.
   *
   * Crucially, fragmentationRequired candidates are NOT rejected from
   * `validation.feasible` (Q3=B — best-effort with soft penalty + visible
   * warning). The flag is a visibility channel only: the run still reaches the
   * GA, the GA flags it via `fragmentationPenalty` (Phase 16 #6), the
   * Fragmented Sessions panel renders the offering (Phase 16 #15), and the
   * Timetable Management warning (Phase 16 #14) drives the admin to fix the
   * underlying timetable per the long-term-intent fix. Absent (omitted) when
   * the candidate's longest run is ≥ sessionDuration — sparse on purpose so a
   * consumer can `if (candidate.fragmentationRequired)` without comparing to
   * `false`.
   */
  fragmentationRequired?: boolean;
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
 *
 * Phase 15 #5 (OQ-25): `lecturerIds: number[]` lives on the session, not the
 * gene/candidate. Multi-sibling cohorts use this to distribute lecturers
 * across their parallel sessions (the chromosome seeder rotates through
 * `candidate.siblingLecturerGroups`). Team-teaching within a single session
 * is preserved — a sibling that team-teaches with multiple lecturers carries
 * the full list on every session it "owns". Single-sibling cohorts stamp
 * `candidate.lecturerIds` on every session (backward compatibility with
 * legacy team-taught offerings and pre-Phase-15 fixtures).
 *
 * For a 3-SKS course split into 2 parallel groups across siblings X and Y:
 *   sessions[0] = { roomId: 10, timeSlotIds: [5, 6, 7], lecturerIds: [X.id] }
 *   sessions[1] = { roomId: 11, timeSlotIds: [5, 6, 7], lecturerIds: [Y.id] }
 */
export interface GeneSession {
  roomId: number;
  timeSlotIds: number[]; // contiguous back-to-back slots, length === sessionDuration
  lecturerIds: number[]; // OQ-25: per-session, length ≥ 1 (team-teach preserved)
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
  lecturerDistributionEntropy: number;
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

/**
 * Phase 16 #2 — per-offering warning record produced by Pre-GA. Surfaced to
 * the API consumer as part of `SchedulerResponse.preGASummary.warnings[]`.
 *
 * Distinct from `infeasible[]` (Q3=B / OQ-33): warnings are offerings that
 * stay in `validation.feasible` and reach the GA, but the timetable cannot
 * hold their session as a single contiguous run — the GA will be forced to
 * fragment the session and surface a `fragmentationPenalty` (Phase 16 #6).
 * The frontend panel (Phase 16 #13/#15) consumes this channel to list the
 * affected offerings without conflating them with hard rejections.
 *
 * `code` is currently always `'FRAGMENTATION_REQUIRED'` — the shape is left
 * open-ended (string) so future Pre-GA visibility channels (e.g., a soft
 * preference warning) can reuse the same envelope without a wire migration.
 */
export interface PreGAWarningEntry {
  offeringId: number;
  code: string;
  message: string;
  /**
   * Mirrors `PreGACandidate.fragmentationRequired` — `true` whenever the
   * candidate's `longestContiguousRun < sessionDuration`. Kept as an
   * explicit boolean (not derived from `code`) so the integration test in
   * Phase 16 #20 can assert on the flag directly.
   */
  fragmentationRequired?: boolean;
  /** Snapshot of `PreGACandidate.longestContiguousRun` for UI rendering. */
  longestContiguousRun?: number;
  /** Snapshot of `PreGACandidate.sessionDuration` for UI rendering. */
  sessionDuration?: number;
  /**
   * Structured payload for future Pre-GA warning codes (parallels
   * `PreGAInfeasibleEntry.metadata`). Unused for `FRAGMENTATION_REQUIRED`.
   */
  metadata?: unknown;
}

export interface SchedulerResponse {
  status: 'SUCCESS' | 'INFEASIBLE' | 'NO_FEASIBLE_CANDIDATES';
  /**
   * Phase 16 #2 — `warnings[]` is a visibility channel for candidates that
   * passed Pre-GA but carry a soft signal the UI should surface (currently
   * only `FRAGMENTATION_REQUIRED`). Warnings never reduce `feasible` and
   * never block the run; consumers that only care about hard rejections
   * keep reading `infeasible[]` and can safely ignore `warnings[]`.
   */
  preGASummary: { feasible: number; infeasible: PreGAInfeasibleEntry[]; warnings: PreGAWarningEntry[] };
  ssaResult?: SSAResult;
  gaResult?: GAResult;
  durationMs: number;
}
