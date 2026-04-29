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
  roomId: number;
  room: Room;
  lecturers: Lecturer[];       // team teaching = multiple
  effectiveStudentCount: number;
  isFixed: boolean;            // pinned by faculty — must not move
  fixedTimeSlotIds?: number[]; // if isFixed, which slots are locked
  parentOfferingId?: number;   // for parallel split offerings
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
  roomId: number;
  lecturerIds: number[];
  requiredSessions: number;    // ⌈effectiveStudentCount / roomCapacity⌉
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

export interface FixedRoomGene {
  kind: 'FIXED';
  offeringId: number;
  roomId: number;            // immutable
  assignedTimeSlotIds: number[]; // length === requiredSessions
}

export interface FlexibleGene {
  kind: 'FLEXIBLE';
  offeringId: number;
  roomId: number;            // mutable
  assignedTimeSlotIds: number[]; // length === requiredSessions
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

export interface SchedulerResponse {
  status: 'SUCCESS' | 'INFEASIBLE' | 'NO_FEASIBLE_CANDIDATES';
  preGASummary: { feasible: number; infeasible: number };
  ssaResult?: SSAResult;
  gaResult?: GAResult;
  durationMs: number;
}
