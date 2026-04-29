Technical Specification Document
Universitas Pembangunan Jaya — Automatic Course Scheduling System
arc42 Architecture Documentation | v1.0

0. Document Preamble
   Audience: Mid-level to senior developers implementing this system. Companion Documents: Research Proposal (Proposal TA), PRD v4.0. Status: Living document — sections marked [ARCH-OBS] are architect observations flagging PRD ambiguities with recommended resolutions.

1. Introduction and Goals
   1.1 The Problem Domain
   Course timetabling is a combinatorial NP-Hard problem. This is not hyperbole — it has been formally proven equivalent to graph coloring, meaning that no known algorithm can solve it optimally in polynomial time as problem size grows. For UPJ's Informatics Faculty, the search space for a single semester involves the cross-product of:
   |Rooms| × |TimeSlots| × |Courses| × |Lecturers| × constraints
   ≈ 15 rooms × 45 slots/week × ~60 offerings × ~20 lecturers
   ≈ > 800,000 possible combinations before constraint filtering

A human with a spreadsheet explores this space heuristically and sequentially. This system explores it in parallel using evolutionary computation.
1.2 Business Goals

Priority
Goal
Success Metric
P0
Zero hard-constraint violations in the final schedule
hardViolations === 0 in GA output
P0
Prevent execution waste on infeasible inputs
SSA rejects infeasible datasets before GA runs
P1
Minimize soft-constraint penalties
Structural lecturer overload penalty < threshold
P1
Reduce scheduling processing time vs. manual
Time from data input to valid schedule < 10 minutes
P2
Provide actionable conflict explanations
Error messages name the specific resources in deadlock
P2
Allow iterative refinement by Kaprodi
Manual lock/override of individual entries post-generation

1.3 UPJ-Specific Policy Goals (2025/2026 Ganjil)
The system must encode three non-negotiable UPJ academic policies as immutable constraints:
Room allocation is proportional to enrolled students. If effectiveStudentCount > 45, the offering is automatically split into parallel sessions sharing one room across different time slots.
Blended students integrate with regular classes when a cohort has fewer than 10 registrants.
Fixed-schedule offerings (pinned by the faculty) must never be moved by the optimization engine.

2. Architecture Constraints
   2.1 Technical Constraints
   Constraint
   Rationale
   TypeScript throughout (backend + shared types)
   Type safety is critical when modeling scheduling constraint graphs — a type error in a chromosome gene maps to a scheduling conflict at runtime
   Prisma ORM
   Existing schema is already Prisma-based (SQLite/libSQL); migrating would break the established migration history
   GA runs server-side only
   Client devices (Kaprodi's laptop) cannot be trusted for consistent computation time; offloading to Node.js ensures reproducibility
   Redis for GA state persistence
   GA runs can take 2–5 minutes; browser refreshes or network drops must not discard in-progress generations
   React frontend is read-only during GA execution
   Race conditions between UI patches and in-progress chromosome evaluation are unacceptable

2.2 Domain Constraints (UPJ Policy Layer)
A lecturer may not be scheduled for more than one course at the same time slot — this includes team-teaching partners.
Special rooms (LAB, Studio) are exclusive to courses that require them — general classrooms may never be substituted.
Structural lecturers (e.g., department heads) have a preferred max of 2 sessions/week — this is a soft constraint but must be tracked.
Parallel offerings share a parentOfferingId — their room assignment is locked; only time slot varies.
For theory classes, start by assigning it to one room. If required session > maximum session in a room, propose another class.
2.3 Political and Organizational Constraints
The system is a prototype for Fakultas Teknologi dan Desain only — multi-faculty scheduling is explicitly out of scope for this iteration.
Scheduling policy follows Semester Ganjil 2025/2026 rules. Policy changes in subsequent semesters require a configuration update, not a code change.
The Kaprodi retains final approval authority — the system is a decision-support tool, not an autonomous scheduler. No schedule is "published" without explicit user validation.

3. Context and Scope
   3.1 System Context Diagram
   ┌────────────────────────────────────────────────────────────────┐
   │ External Context │
   │ │
   │ ┌──────────────┐ ┌──────────────────────────────┐ │
   │ │ Kaprodi │ ────────►│ GA Scheduler System │ │
   │ │ (Head of │ HTTP │ │ │
   │ │ Program) │◄──────── │ ┌─────────┐ ┌──────────┐ │ │
   │ └──────────────┘ JSON │ │ React │ │ Express │ │ │
   │ │ │Frontend │ │ API │ │ │
   │ ┌──────────────┐ │ └─────────┘ └──────────┘ │ │
   │ │ Academic │ ────────►│ ↓ ↓ │ │
   │ │ Admin │ │ ┌──────────────────────┐ │ │
   │ └──────────────┘ │ │ GA Engine (Node) │ │ │
   │ │ └──────────────────────┘ │ │
   │ │ ↓ ↓ │ │
   │ │ ┌──────────┐ ┌────────┐ │ │
   │ │ │ SQLite/ │ │ Redis │ │ │
   │ │ │ libSQL │ │ Cache │ │ │
   │ │ └──────────┘ └────────┘ │ │
   │ └──────────────────────────────┘ │
   └────────────────────────────────────────────────────────────────┘

3.2 Scope Boundaries
In scope:
CRUD management for all scheduling entities (rooms, lecturers, courses, offerings, time slots)
Pre-GA policy transformation (blended consolidation, parallel splitting)
Static Structural Analysis (feasibility gate)
GA core execution with three crossover strategies
Schedule visualization, conflict detection, manual override, lock mechanism
CSV export of the final schedule
Out of scope:
Multi-faculty scheduling
Student timetable view
Lecturer preference input UI (preferences are currently encoded at the constraint level, not via a preference form)
Integration with the university's existing academic information system (SIAK)
Real-time collaborative editing (concurrent Kaprodi sessions)

4. Solution Strategy
   4.1 The Three-Layer Pipeline
   The core architectural decision is to separate concerns into three sequential gates. A schedule request must pass through all three layers in order. This is not a microservices split — all three layers run in the same Node.js process — but they are logically and structurally decoupled.
   [User Submits Run Request]
   │
   ▼
   ┌─────────────────────┐
   │ Layer 1: Pre-GA │ Deterministic. Policy enforcement.
   │ Policy Engine │ Transforms raw DB data into a
   │ │ canonicalized candidate set.
   │ ~O(n) complexity │
   └────────┬────────────┘
   │ feasible[] + infeasible[]
   ▼
   ┌─────────────────────┐
   │ Layer 2: Static │ Deterministic. Infeasibility detection.
   │ Structural Analysis│ Kills the run BEFORE wasting CPU on GA
   │ (SSA / Hopcroft- │ if no valid schedule can exist.
   │ Karp / AC-3) │
   │ O(E√V) complexity │
   └────────┬────────────┘
   │ FEASIBLE signal only
   ▼
   ┌─────────────────────┐
   │ Layer 3: GA Core │ Probabilistic. Evolutionary optimization.
   │ (Genetic Algorithm)│ Explores the valid search space to find
   │ │ the best schedule respecting soft constraints.
   │ O(g × p × n) │
   └─────────────────────┘

4.2 Technology Choice Rationale
TypeScript + Prisma: The scheduling domain model is deeply relational — offerings have lecturers, rooms have facilities, courses have requirements. The Prisma-generated types create a compile-time contract between the DB schema and the GA engine, preventing the most common class of runtime bugs (field name mismatches, null/undefined propagation through candidate objects). A bug in chromosome gene construction that references a wrong field name is caught at tsc time, not at 2 AM during a GA run.
Fisher-Yates for population initialization: The existing codebase already makes this correct choice. Array.sort(() => Math.random() - 0.5) produces biased permutations; Fisher-Yates guarantees uniform distribution, which is essential for unbiased initial population quality.
Conflict-aware repair post-crossover: This is a pragmatic deviation from "pure" GA theory. Standard GA relies purely on fitness pressure to reduce violations over generations. The current implementation applies a greedy repair step immediately after crossover, which dramatically accelerates convergence to hardViolations = 0. The tradeoff is that repair introduces a greedy bias — but given the time constraints of an academic scheduling cycle, this is the correct engineering decision.

5. Building Block View
   5.1 Level 1 — System Modules
   ga_scheduler_lab/
   ├── frontend/ # Presentation Layer
   │ └── src/
   │ ├── pages/ # SchedulerPage, LoginPage
   │ ├── components/ # ScheduleGrid, ConflictPanel, GAConfigModal
   │ ├── store/ # Zustand state (schedulerStore, authStore)
   │ └── lib/api.ts # Typed axios wrappers
   │
   └── src/
   ├── api/ # Transport Layer
   │ ├── routes/ # scheduler.ts, offerings.ts, rooms.ts ...
   │ ├── services/ # scheduler.service.ts (orchestration)
   │ └── middleware/ # auth, authorize, errorHandler
   │
   ├── pre-ga/ # Layer 1: Policy Engine
   │ ├── checks/ # integrity, room, temporal, facility, lecturer, policy
   │ ├── validator.ts # runPreGA() orchestrator
   │ └── candidate.ts # PreGACandidate type definition
   │
   ├── ssa/ # Layer 2: Static Structural Analysis [TO BE BUILT]
   │ ├── ac3.ts # Constraint propagation
   │ ├── bipartiteGraph.ts # Graph construction
   │ └── hopcroftKarp.ts # Maximum matching algorithm
   │
   ├── ga/ # Layer 3: GA Core
   │ ├── chromosome.ts # Gene/Chromosome types, createRandomChromosome
   │ ├── population.ts # generateInitialPopulation
   │ ├── fitness.ts # evaluateFitness, evaluateHardFitness
   │ ├── selection.ts # tournamentSelection
   │ ├── mutation.ts # mutateChromosome
   │ ├── repair.ts # repairChromosome (conflict-aware greedy)
   │ ├── diversity.ts # checkDiversity (pre-run diagnostics)
   │ └── runGA.ts # Main evolutionary loop
   │
   ├── crossovers/ # Crossover Operators
   │ ├── singlePoint.ts
   │ ├── uniform.ts
   │ └── partiallyMapped.ts
   │
   └── db/ # Data Layer
   ├── client.ts # Prisma singleton
   └── seed.ts # Development data

5.2 Module Responsibilities
Input Processor (api/routes/, api/services/scheduler.service.ts) Receives the run request, validates configuration parameters, and orchestrates the three-layer pipeline. The scheduler.service.ts is the single point of entry for a scheduling run — it calls runPreGA(), then (when SSA is implemented) calls runSSA(), then calls runGA(). This is currently the module with the most technical debt, as Layer 2 is not yet implemented.
Feasibility Engine (pre-ga/, ssa/) The pre-GA layer performs six sequential checks per offering (integrity → room capacity → temporal sufficiency → facility compatibility → lecturer availability → academic policy). The SSA layer performs graph-theoretic global feasibility analysis. Both layers are pure functions — they take data in, return a result, and have no side effects beyond logging.
GA Core (ga/, crossovers/) The evolutionary loop with clearly defined boundaries. The runGA() function takes PreGACandidate[] and a GAConfig object and returns a GAResult. It has no knowledge of Prisma or Express — this isolation is critical for testability and for the comparison experiments required by the thesis (running three crossover strategies against identical inputs).
Persistence and Export (api/services/scheduler.service.ts, planned ssa/redis/) Converts the winning chromosome back to human-readable ScheduledEntry[] objects via a batch DB query. Redis persistence for in-progress runs is specified in the PRD but not yet implemented in the current codebase.

6. Runtime View
   6.1 Complete Request Lifecycle
   [POST /api/scheduler/run]
   │
   │ 1. HTTP Request received
   ▼
   [scheduler.service.ts::runScheduler()]
   │
   │ 2. Call runPreGA()
   ▼
   [pre-ga/validator.ts::runPreGA()]
   │
   │ 3. Fetch all CourseOfferings + relations from DB (single query)
   │ 4. For each offering, run 6 sequential checks:
   │ integrity → roomCapacity → temporal → facility → lecturer → policy
   │
   │ 5. Partition into feasible[] and infeasible[]
   │ 6. Fetch all TimeSlots from DB
   │ 7. Build PreGACandidate[] for each feasible offering
   │ (possibleTimeSlotIds = ALL timeslots at this stage)
   ▼
   [IF feasible.length === 0]
   │ → Return 422 NO_FEASIBLE_CANDIDATES immediately
   │
   [ELSE continue]
   │
   │ 8. [SSA GATE — Currently Missing, See Section 6.2]
   │
   │ 9. checkDiversity(candidates) — diagnostic, non-blocking
   │ 10. Build lecturerStructuralMap from DB
   │
   ▼
   [ga/runGA.ts::runGA()]
   │
   │ 11. generateInitialPopulation() × populationSize
   │ → createRandomChromosome() per individual
   │ → Fisher-Yates shuffle of possibleTimeSlotIds
   │ → Slice first requiredSessions IDs
   │ → Apply noise (noiseRate=0.15) for diversity
   │ → repairChromosome() on every initial individual
   │
   │ 12. For each generation (g = 0..generations):
   │
   │ a. evaluateFitness() for all chromosomes
   │ → evaluateHardFitness(): room-time + lecturer-time collision count
   │ → calculateStructuralPenalty(): soft penalty for overloaded lecturers
   │ → Combined fitness: lexicographic (hardViolations=0 required for soft to matter)
   │
   │ b. Sort population by fitness descending
   │ c. Log best fitness, avg fitness, hard violations, soft penalty
   │ d. Copy top elitismCount chromosomes to next generation (elitism)
   │
   │ e. WHILE newPopulation.length < populationSize:
   │ parent1 = tournamentSelection(tournamentSize)
   │ parent2 = tournamentSelection(tournamentSize)
   │ [child1, child2] = crossover(parent1, parent2)
   │ mutated1 = mutateChromosome(child1, mutationRate)
   │ mutated2 = mutateChromosome(child2, mutationRate)
   │ repaired1 = repairChromosome(mutated1)
   │ repaired2 = repairChromosome(mutated2)
   │ newPopulation.push(repaired1, repaired2)
   │
   │ f. population = newPopulation
   │
   │ 13. Return GAResult: bestChromosome, history[], avgHistory[]
   ▼
   [scheduler.service.ts]
   │
   │ 14. chromosomeToEntries(bestChromosome, candidates)
   │ → Batch query: fetch offering details for all offeringIds
   │ → Batch query: fetch TimeSlot objects for all assignedTimeSlotIds
   │ → Map gene → ScheduledEntry (human-readable)
   │
   │ 15. Return SchedulerResponse to HTTP client
   ▼
   [Frontend]
   │ 16. setResults() in schedulerStore
   │ 17. deriveConflicts() from entries (client-side, for display)
   │ 18. Render ScheduleGrid, SummaryPanel, ConflictPanel

6.2 Layer 2: SSA Runtime — The Deadlock Prevention Logic
This is the most academically and architecturally significant component. It must be inserted between steps 8 and 9 in the flow above. Here is the detailed logic:
Why GA must not run if SSA fails:
The GA explores the search space by sampling chromosomes. If the search space is empty — that is, if no valid assignment of time slots to offerings can satisfy the hard constraints — then the GA will run for the full configured number of generations, produce chromosomes with hardViolations > 0, and return a "best" result that is still invalid. This wastes 2–5 minutes of server computation time and misleads the user into thinking the problem is merely difficult rather than mathematically impossible.
The SSA's job is to determine, in O(E√V) time (compared to GA's O(g × p × n)), whether the feasible region is non-empty.
Implementation — Bipartite Matching via Hopcroft-Karp:
// Conceptual implementation for ssa/hopcroftKarp.ts

interface BipartiteGraph {
// Left nodes: individual sessions (an offering with requiredSessions=2
// contributes 2 left nodes)
sessions: SessionNode[];
// Right nodes: (TimeSlot × Room) pairs that are valid for the session
slots: SlotNode[];
// Edges: session → slot (exists if slot is in possibleTimeSlotIds AND
// no fixed constraint prevents the assignment)
edges: Map<number, Set<number>>;
}

interface SSAResult {
feasible: boolean;
maximumMatching: number;
requiredMatching: number;
// If infeasible, which sessions have empty or insufficient domains?
conflictingSessionIds?: number[];
deadlockDescription?: string;
}

function runHopcroftKarp(graph: BipartiteGraph): SSAResult {
const totalSessions = graph.sessions.length;
const matching = hopcroftKarp(graph.edges, totalSessions, graph.slots.length);

return {
feasible: matching === totalSessions,
maximumMatching: matching,
requiredMatching: totalSessions,
// ... deadlock identification logic
};
}

The key invariant: If maximumMatching < totalSessions, then at least one session cannot be assigned any time slot without conflicting with another session's assignment. The difference totalSessions - maximumMatching gives the exact number of sessions that are "orphaned" — structurally unschedulable.
AC-3 Constraint Propagation (pre-matching domain reduction):
Before running Hopcroft-Karp (which is O(E√V) and can be expensive for large graphs), run AC-3 to prune domains:
For each offering O:
For each slot S in O.possibleTimeSlotIds:
If any other offering O' exists such that: - O' shares the same room as O (same roomId) - O' has S as its ONLY possible slot
Then: Remove S from O.possibleTimeSlotIds

If O.possibleTimeSlotIds.length < O.requiredSessions:
→ ABORT immediately. Report: "Offering [id] has insufficient
available time slots after constraint propagation."

AC-3 reduces the graph size before Hopcroft-Karp runs, making the overall SSA faster in practice.
SSA failure output (what the UI must display):
interface SSAFailureReport {
code: 'STRUCTURAL_INFEASIBILITY';
message: string; // Human-readable: "Cannot schedule all sessions"
details: {
totalSessionsRequired: number;
maximumAchievableSchedule: number;
// The specific resource contention causing deadlock
problematicResources: Array<{
type: 'ROOM' | 'LECTURER' | 'TIME_SLOT';
resourceId: number;
resourceName: string;
conflictingOfferingIds: number[];
}>;
};
}

6.3 Chromosome Data Model and Crossover Mechanics
Chromosome = Gene[] (one Gene per feasible CourseOffering)

Gene = {
offeringId: number, // FK to CourseOffering
assignedTimeSlotIds: number[] // length === requiredSessions
}

Ordered Crossover (OX) — the partiallyMappedCrossover implementation:
PMX is the closest analog to OX in the current codebase. The key invariant it preserves: every offering retains a valid time slot assignment (drawn from its possibleTimeSlotIds). This is critical because unlike the classic TSP version of OX, our "values" (time slot IDs) are not globally unique — two offerings in different rooms CAN share the same time slot. The mapping chain in PMX handles conflicts within the same room.
Swap Mutation (the mutateChromosome implementation):
With probability mutationRate per gene, the entire assignedTimeSlotIds array is replaced with a fresh random selection. This is effectively a "reset" mutation, which is stronger than a single-slot swap but prevents premature convergence.
[ARCH-OBS-01]: The current mutation implementation uses Array.sort(() => 0.5 - Math.random()) for selection within mutation, which has the same bias problem that was correctly solved in createRandomChromosome. This should be refactored to use Fisher-Yates for consistency and correctness.
6.4 Fitness Function — Lexicographic Priority
The current implementation uses a lexicographic fitness scheme rather than the weighted sum 1/(1 + hard + α·soft) noted in comments:
// From fitness.ts (actual implementation):
if (hard.hardViolations > 0) {
fitness = 1 / (1 + hard.hardViolations); // Range: (0, 0.5]
} else {
fitness = 2 + (1 / (1 + structuralPenalty)); // Range: (2, 3]
}

This is architecturally correct and superior to the weighted sum because it creates a strict priority hierarchy: any chromosome with zero hard violations will always outrank any chromosome with hard violations, regardless of soft penalty. The weighted-sum approach can produce a perverse result where a chromosome with many hard violations but low soft penalty is ranked above a chromosome with one hard violation but zero soft penalty.

7. Deployment View
   7.1 Process Architecture
   ┌─────────────────────────────────────────────┐
   │ Server (Node.js Process) │
   │ │
   │ ┌──────────────┐ ┌─────────────────────┐ │
   │ │ Express API │ │ GA Worker │ │
   │ │ (port 3000) │───►│ (same process, │ │
   │ │ │ │ async/await) │ │
   │ │ Rate limited:│ │ │ │
   │ │ 5 GA runs │ │ CPU-intensive: │ │
   │ │ per 5 min │ │ blocks event loop │ │
   │ └──────────────┘ │ during GA gen │ │
   │ └─────────────────────┘ │
   │ │
   │ ┌──────────────┐ ┌─────────────────────┐ │
   │ │ SQLite/libSQL│ │ Redis │ │
   │ │ (Prisma) │ │ (GA state cache) │ │
   │ └──────────────┘ └─────────────────────┘ │
   └─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Client (Browser) │
│ React SPA (Vite, port 5173 in dev) │
│ Proxies /api → :3000 │
└─────────────────────────────────────────────┘

[ARCH-OBS-02]: The GA currently runs synchronously in the Express request handler, which blocks the Node.js event loop for the duration of the run (potentially 2–5 minutes). This means no other API requests can be served during a GA run. For a prototype with a single Kaprodi user, this is acceptable. For production, the GA should be moved to a Worker Thread or a job queue (BullMQ + Redis) with SSE or WebSocket for progress updates.
7.2 Redis State Persistence Schema
The PRD specifies checkpoint persistence. The recommended schema:
Key: ga:run:{runId}:state
TTL: 3600 seconds (1 hour)
Value: JSON {
runId: string,
status: 'RUNNING' | 'COMPLETED' | 'FAILED',
config: GAConfig,
currentGeneration: number,
bestFitness: number,
bestChromosome: Chromosome, // serialized
history: number[],
candidates: PreGACandidate[], // needed for resume
startedAt: ISO8601,
lastCheckpointAt: ISO8601
}

Key: ga:run:{runId}:progress (Stream or Pub/Sub for SSE)

Checkpoint frequency: every 10 generations. A resumed run re-hydrates the population state from bestChromosome as a seed individual plus fresh random individuals to maintain diversity.

8. Cross-cutting Concerns
   8.1 Authentication and Authorization Model
   Two roles are defined. The authorization layer correctly uses middleware composition:
   ADMIN → Full access to all endpoints including room/facility/timeslot management
   HEAD_OF_PROGRAM_STUDY → courses, lecturers, offerings, and scheduler endpoints only

All GA run requests require authentication. This is important because GA runs are CPU-intensive — unauthenticated access would allow trivial DoS attacks.
8.2 GA Stagnation Exit (Safety Mechanism)
The PRD specifies a "Forced Stop" if the GA stagnates. Implementation recommendation:
// In runGA.ts, add to the generation loop:
const STAGNATION_WINDOW = 15; // generations
const STAGNATION_THRESHOLD = 0.0001; // minimum fitness improvement

let generationsSinceImprovement = 0;
let lastBestFitness = -Infinity;

// Inside the generation loop:
if (best.fitness - lastBestFitness < STAGNATION_THRESHOLD) {
generationsSinceImprovement++;
if (generationsSinceImprovement >= STAGNATION_WINDOW && best.hardViolations > 0) {
console.warn(`GA stagnated at generation ${gen}. Hard violations remain: ${best.hardViolations}`);
break; // Early exit with best-so-far
}
} else {
generationsSinceImprovement = 0;
lastBestFitness = best.fitness;
}

This should only trigger early exit if hardViolations > 0. If the GA has reached a valid schedule and is optimizing soft constraints, stagnation is acceptable and the full generation count should complete.
8.3 Audit Trail for Thesis Validation
The thesis Chapter 4 requires empirical data on GA convergence. The current history[] and avgHistory[] arrays in GAResult satisfy this for fitness curves. Additionally, log the following for each run:
interface RunAuditLog {
runId: string;
timestamp: ISO8601;
config: GAConfig;
preGASummary: { feasible: number; infeasible: number; };
ssaResult: SSAResult; // Once implemented
diversityReport: DiversityReport;
finalResult: {
hardViolations: number;
softPenalty: number;
bestFitness: number;
generationsRun: number;
stagnatedEarly: boolean;
};
durationMs: number;
}

Store these in the database (AuditLog table) for later analysis. This data directly feeds the thesis discussion on algorithm effectiveness.
8.4 Team Teaching Conflict Detection
[ARCH-OBS-03]: The PRD and proposal both mention team teaching (multiple lecturers per course) as a specific constraint. The current Prisma schema handles this correctly via CourseOfferingLecturer (many-to-many). However, the evaluateHardFitness function must correctly expand lecturerIds: number[] per gene and check each lecturer against the full lecturerTimeMap. The current implementation does this correctly in fitness.ts — but the repairChromosome function must also handle the case where a gene has multiple lecturers, ensuring the slot reassignment avoids conflicts for all lecturers of the offering, not just the first.
The buildConflictIndex in repair.ts iterates for (const lecturerId of candidate.lecturerIds), which is correct. Verify this is preserved in any refactoring.
8.5 Error Handling Contract
All API errors follow the standardized envelope:
{
success: false,
error: {
code: string, // Machine-readable: 'NO_FEASIBLE_CANDIDATES', 'STRUCTURAL_INFEASIBILITY'
message: string // Human-readable for display in React ErrorToast
}
}

The frontend ErrorToast component reads runError from schedulerStore. Ensure that SSA failure responses use the same envelope and surface the problematicResources array in a dedicated ConflictVisualizerPanel component (per PRD requirement for "Constraint Conflict Visualizer").

9. Architecture Decision Records (ADRs)
   ADR-01: Lexicographic vs. Weighted-Sum Fitness
   Decision: Use lexicographic fitness (hard violations strictly dominate). Rationale: Prevents the weighted-sum perversity where heavy soft-constraint optimization can mask hard violations. A schedule with one room conflict is always invalid, regardless of how well it distributes lecturer load. Consequence: The fitness scale is non-continuous (jumps from range (0,0.5] to (2,3] when hard violations reach zero). History charts must display this correctly — raw values are fine, but axis labels in the FitnessChart component should indicate the discontinuity.
   ADR-02: Conflict-Aware Repair as Standard Component
   Decision: Apply repairChromosome() after every crossover+mutation operation, including on the initial population. Rationale: Without repair, the GA spends early generations discovering that random assignments produce conflicts. Repair pre-filters this, allowing fitness pressure to focus on soft-constraint optimization earlier. The thesis comparison experiments should include a run variant WITHOUT repair to demonstrate its contribution. Consequence: The GA is no longer "pure" evolutionary — it includes a greedy local search component. This is a Lamarckian GA variant and should be described as such in the thesis methodology section.
   ADR-03: SSA as a Hard Gate (GA Blocked if SSA Fails)
   Decision: If hopcroftKarp(graph).maximumMatching < totalSessions, the API returns a 422 with a detailed deadlock report. The GA is not invoked. Rationale: A GA run on an infeasible problem wastes compute resources and produces a misleading result (the "best" chromosome still violates hard constraints). Fail fast with actionable information. Consequence: The SSA must be implemented and integrated before the system can claim correctness guarantees. The current codebase (as of the provided source) does not implement Layer 2 — this is the highest priority development item remaining.

10. Open Issues and Development Priorities
    Priority
    Issue
    Resolution
    CRITICAL
    SSA (Layer 2) not implemented
    Implement ssa/bipartiteGraph.ts and ssa/hopcroftKarp.ts; wire into scheduler.service.ts between Pre-GA and GA
    HIGH
    Redis checkpoint persistence not implemented
    Implement ga:run:{id}:state key with 10-generation checkpoint interval
    HIGH
    Stagnation exit not implemented
    Add stagnation detection to runGA.ts generation loop
    MEDIUM
    Mutation uses biased shuffle
    Replace Array.sort(() => Math.random() - 0.5) in mutateChromosome with Fisher-Yates
    MEDIUM
    Constraint Conflict Visualizer UI missing
    Build SSAFailurePanel React component to display problematicResources graph
    MEDIUM
    AuditLog table not in Prisma schema
    Add migration for RunAuditLog model; persist after each GA run
    LOW
    GA blocks event loop during run
    Refactor to Worker Thread for production readiness (acceptable as prototype)
    LOW
    FitnessChart doesn't annotate fitness scale discontinuity
    Add annotation at fitness = 2 threshold indicating "Hard violations resolved"

11. Open Issues and Development Priorities (Continued)
    10.1 Detailed Implementation Specifications for Critical Items

CRITICAL: SSA Implementation
This is the most significant gap between the current codebase and the PRD specification. The following provides implementation-ready TypeScript for all three SSA components.
Step 1 — Bipartite Graph Construction (ssa/bipartiteGraph.ts)
import type { PreGACandidate } from '../pre-ga/candidate.js';

export interface SessionNode {
// A single schedulable unit. One offering with requiredSessions=2
// produces TWO session nodes (sessionIndex 0 and 1).
sessionId: number; // Globally unique: offeringId \* 100 + sessionIndex
offeringId: number;
sessionIndex: number; // 0-based within the offering
roomId: number;
lecturerIds: number[];
}

export interface SlotNode {
slotId: number; // TimeSlot.id from the database
}

export interface BipartiteGraph {
sessions: SessionNode[];
slots: SlotNode[];
// adjacency[sessionId] = Set of slotIds that this session CAN occupy
adjacency: Map<number, Set<number>>;
}

/\*\*

- Builds the bipartite graph where:
- Left = individual sessions (expanded from offerings)
- Right = available time slots
- Edge = session can be assigned to slot (no resource conflict
-           with OTHER sessions that are already pinned/fixed)
-
- NOTE: At this stage, we do NOT yet know which sessions will
- conflict with each other — that's what the matching algorithm
- determines. The edges represent the DOMAIN of each session.
  \*/
  export function buildBipartiteGraph(
  candidates: PreGACandidate[]
  ): BipartiteGraph {
  const sessions: SessionNode[] = [];
  const slotIdSet = new Set<number>();

// Expand offerings into individual sessions
for (const candidate of candidates) {
for (let i = 0; i < candidate.requiredSessions; i++) {
const sessionId = candidate.offeringId \* 100 + i;
sessions.push({
sessionId,
offeringId: candidate.offeringId,
sessionIndex: i,
roomId: candidate.roomId,
lecturerIds: candidate.lecturerIds,
});
candidate.possibleTimeSlotIds.forEach(s => slotIdSet.add(s));
}
}

const slots: SlotNode[] = Array.from(slotIdSet).map(id => ({ slotId: id }));

// Build adjacency: initially each session can use ALL its possible slots.
// AC-3 will prune this before Hopcroft-Karp runs.
const adjacency = new Map<number, Set<number>>();
for (const session of sessions) {
const candidate = candidates.find(c => c.offeringId === session.offeringId)!;
adjacency.set(session.sessionId, new Set(candidate.possibleTimeSlotIds));
}

return { sessions, slots, adjacency };
}

Step 2 — AC-3 Constraint Propagation (ssa/ac3.ts)
import type { BipartiteGraph, SessionNode } from './bipartiteGraph.js';

export interface AC3Result {
consistent: boolean;
// If inconsistent, which session ran out of domain values?
emptyDomainSessionId?: number;
emptyDomainOfferingId?: number;
reason?: string;
}

/\*\*

- Arc Consistency Algorithm 3 (AC-3)
-
- For timetabling, we apply a simplified version:
- Prune time slots from a session's domain if that slot is
- exclusively reserved by another session in the SAME room.
-
- A slot is "exclusively reserved" by session S in room R if:
- 1.  S is the ONLY session that CAN use room R at slot T
-      (i.e., no other slot exists in S's domain)
-
- This propagates forced assignments and detects immediate
- infeasibility before running the expensive matching algorithm.
-
- Complexity: O(n²) in the worst case, but typically O(n log n)
- in practice for scheduling problems.
  \*/
  export function runAC3(graph: BipartiteGraph): AC3Result {
  const { sessions, adjacency } = graph;

// Build room → sessions index for fast lookup
const roomToSessions = new Map<number, SessionNode[]>();
for (const session of sessions) {
if (!roomToSessions.has(session.roomId)) {
roomToSessions.set(session.roomId, []);
}
roomToSessions.get(session.roomId)!.push(session);
}

// Build lecturer → sessions index
const lecturerToSessions = new Map<number, SessionNode[]>();
for (const session of sessions) {
for (const lecturerId of session.lecturerIds) {
if (!lecturerToSessions.has(lecturerId)) {
lecturerToSessions.set(lecturerId, []);
}
lecturerToSessions.get(lecturerId)!.push(session);
}
}

// Worklist: pairs of (session, constraining-session) to check
// Start with all pairs that share a resource (room or lecturer)
const worklist: Array<[number, number]> = [];

for (const [, roomSessions] of roomToSessions) {
for (let i = 0; i < roomSessions.length; i++) {
for (let j = i + 1; j < roomSessions.length; j++) {
worklist.push([roomSessions[i]!.sessionId, roomSessions[j]!.sessionId]);
worklist.push([roomSessions[j]!.sessionId, roomSessions[i]!.sessionId]);
}
}
}

for (const [, lecturerSessions] of lecturerToSessions) {
for (let i = 0; i < lecturerSessions.length; i++) {
for (let j = i + 1; j < lecturerSessions.length; j++) {
const pair1: [number, number] = [
lecturerSessions[i]!.sessionId,
lecturerSessions[j]!.sessionId
];
const pair2: [number, number] = [
lecturerSessions[j]!.sessionId,
lecturerSessions[i]!.sessionId
];
// Avoid duplicate pairs
if (!worklist.some(([a, b]) => a === pair1[0] && b === pair1[1])) {
worklist.push(pair1);
worklist.push(pair2);
}
}
}
}

// Process worklist
while (worklist.length > 0) {
const [xi, xj] = worklist.pop()!;
const domainI = adjacency.get(xi);
const domainJ = adjacency.get(xj);

    if (!domainI || !domainJ) continue;

    const sessionI = sessions.find(s => s.sessionId === xi)!;
    const sessionJ = sessions.find(s => s.sessionId === xj)!;

    // Determine what constraint exists between xi and xj
    const shareRoom = sessionI.roomId === sessionJ.roomId;
    const sharedLecturers = sessionI.lecturerIds
      .filter(id => sessionJ.lecturerIds.includes(id));

    const hasConstraint = shareRoom || sharedLecturers.length > 0;
    if (!hasConstraint) continue;

    // For each value in domain(xi), check if there exists at least
    // one consistent value in domain(xj).
    // Since the constraint is "cannot share the same time slot",
    // a value v in domain(xi) is consistent IF domain(xj) contains
    // at least one value OTHER than v.
    const toRemove: number[] = [];

    for (const slot of domainI) {
      // Is there any slot in domainJ that is different from this slot?
      const hasConsistentValue = domainJ.size > 1 ||
        (domainJ.size === 1 && !domainJ.has(slot));

      if (!hasConsistentValue) {
        // If xj has only ONE slot and it's the same as xi's slot,
        // then xi cannot use this slot (would force a conflict).
        // But we only remove if xj is FORCED to use this slot
        // (i.e., xj has no other option).
        if (domainJ.size === 1 && domainJ.has(slot)) {
          toRemove.push(slot);
        }
      }
    }

    if (toRemove.length > 0) {
      for (const slot of toRemove) {
        domainI.delete(slot);
      }

      if (domainI.size === 0) {
        const offeringId = sessionI.offeringId;
        return {
          consistent: false,
          emptyDomainSessionId: xi,
          emptyDomainOfferingId: offeringId,
          reason: `TEMPORAL_DEADLOCK: Offering ${offeringId} session ${sessionI.sessionIndex} ` +
                  `has no available time slots after constraint propagation. ` +
                  `All slots are exclusively needed by conflicting sessions.`,
        };
      }

      // Domain was revised — add back all arcs involving xi
      // (other sessions that share a resource with xi)
      const relatedSessions = [
        ...(roomToSessions.get(sessionI.roomId) ?? []),
        ...sessionI.lecturerIds.flatMap(
          id => lecturerToSessions.get(id) ?? []
        ),
      ].filter(s => s.sessionId !== xi);

      for (const related of relatedSessions) {
        worklist.push([related.sessionId, xi]);
      }
    }

}

return { consistent: true };
}

Step 3 — Hopcroft-Karp Maximum Bipartite Matching (ssa/hopcroftKarp.ts)
import type { BipartiteGraph } from './bipartiteGraph.js';

export interface MatchingResult {
maximumMatching: number;
// Maps sessionId → slotId for matched pairs
sessionToSlot: Map<number, number>;
// Maps slotId → sessionId for reverse lookup
slotToSession: Map<number, number>;
// Sessions that could not be matched (infeasible ones)
unmatchedSessions: number[];
}

/\*\*

- Hopcroft-Karp Algorithm for Maximum Bipartite Matching
-
- Finds the maximum number of sessions that can be simultaneously
- assigned to distinct time slots while respecting the adjacency
- (domain) constraints.
-
- If maximumMatching < totalSessions, the scheduling problem
- is PROVABLY INFEASIBLE — there exists no valid assignment
- of time slots to all sessions simultaneously.
-
- Time Complexity: O(E × √V) where:
- E = total edges in the bipartite graph (sum of domain sizes)
- V = total nodes (sessions + slots)
-
- This is significantly faster than naive augmenting path:
- O(V × E) for the Hungarian algorithm variant.
  \*/
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

// dist[sessionId] = BFS layer distance (for phase structure)
const dist = new Map<number, number>();

let matching = 0;

/\*\*

- BFS phase: finds shortest augmenting path layers.
- Returns true if any augmenting path exists.
  \*/
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

/\*\*

- DFS phase: augments along shortest paths found in BFS.
- Returns true if an augmenting path was found from sessionId.
  \*/
  function dfs(sessionId: number): boolean {
  const slots = adjacency.get(sessionId) ?? new Set<number>();
  const sessionDist = dist.get(sessionId)!;


    for (const slotId of slots) {
      const pairedSessionId = matchR.get(slotId) ?? -1;

      const canAugment = pairedSessionId === -1 ||
        (dist.get(pairedSessionId) === sessionDist + 1 &&
         dfs(pairedSessionId));

      if (canAugment) {
        matchL.set(sessionId, slotId);
        matchR.set(slotId, sessionId);
        return true;
      }
    }

    // No augmenting path from this node — mark as visited
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

// Identify unmatched sessions for error reporting
const unmatchedSessions = sessions
.filter(s => matchL.get(s.sessionId) === -1)
.map(s => s.sessionId);

return {
maximumMatching: matching,
sessionToSlot: matchL as Map<number, number>,
slotToSession: matchR as Map<number, number>,
unmatchedSessions,
};
}

Step 4 — SSA Orchestrator (ssa/index.ts)
import type { PreGACandidate } from '../pre-ga/candidate.js';
import { buildBipartiteGraph } from './bipartiteGraph.js';
import { runAC3 } from './ac3.js';
import { runHopcroftKarp } from './hopcroftKarp.js';

export type SSAStatus = 'FEASIBLE' | 'INFEASIBLE';

export interface SSAResult {
status: SSAStatus;
totalSessionsRequired: number;
maximumAchievableMatching: number;
// Present only when status === 'INFEASIBLE'
deadlockReport?: DeadlockReport;
}

export interface DeadlockReport {
code: 'AC3_DOMAIN_EMPTY' | 'BIPARTITE_MATCHING_INSUFFICIENT';
message: string;
affectedOfferingIds: number[];
recommendation: string;
}

export async function runSSA(
candidates: PreGACandidate[]
): Promise<SSAResult> {
const totalSessionsRequired = candidates.reduce(
(sum, c) => sum + c.requiredSessions, 0
);

// Phase 1: Build the bipartite graph from candidate domains
const graph = buildBipartiteGraph(candidates);

// Phase 2: AC-3 constraint propagation (domain reduction)
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

// Phase 3: Hopcroft-Karp maximum bipartite matching
const matchingResult = runHopcroftKarp(graph);

if (matchingResult.maximumMatching < totalSessionsRequired) {
// Identify which offerings contain the unmatched sessions
const unmatchedOfferingIds = [
...new Set(
matchingResult.unmatchedSessions.map(sessionId => {
// sessionId = offeringId * 100 + sessionIndex
return Math.floor(sessionId / 100);
})
),
];

    return {
      status: 'INFEASIBLE',
      totalSessionsRequired,
      maximumAchievableMatching: matchingResult.maximumMatching,
      deadlockReport: {
        code: 'BIPARTITE_MATCHING_INSUFFICIENT',
        message:
          `Structural infeasibility detected: ${totalSessionsRequired} sessions ` +
          `require scheduling, but only ${matchingResult.maximumMatching} can be ` +
          `simultaneously assigned without conflict. ` +
          `${totalSessionsRequired - matchingResult.maximumMatching} session(s) ` +
          `cannot be scheduled under current constraints.`,
        affectedOfferingIds: unmatchedOfferingIds,
        recommendation:
          'Consider: (1) adding more time slots to the timetable, ' +
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

Step 5 — Wire SSA into the Scheduler Service
// In scheduler.service.ts::runScheduler(), between runPreGA() and runGA():

import { runSSA } from '../../ssa/index.js';

// After Pre-GA validation:
const ssaResult = await runSSA(candidates);

if (ssaResult.status === 'INFEASIBLE') {
// Return structured error — do NOT proceed to GA
return {
status: 'INFEASIBLE',
preGASummary: { ... },
ssaResult,
// No bestResult — GA was never run
};
}

// Only reach here if SSA confirmed feasibility
const gaResult = runGA(candidates, lecturerStructuralMap, config);

HIGH: Redis Checkpoint Persistence
Prisma schema addition (prisma/schema.prisma):
model GARun {
id String @id @default(cuid())
status String // 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STAGNATED'
config String // JSON serialized GAConfig
currentGeneration Int @default(0)
bestFitness Float @default(0)
hardViolations Int @default(0)
softPenalty Int @default(0)
historyJson String @default("[]") // JSON array of per-gen best fitness
avgHistoryJson String @default("[]")
startedAt DateTime @default(now())
completedAt DateTime?
errorMessage String?

@@map("ga_runs")
}

Redis checkpoint manager (ssa/redis/gaCheckpoint.ts):
import { createClient } from 'redis';
import type { Chromosome } from '../../ga/chromosome.js';
import type { PreGACandidate } from '../../pre-ga/candidate.js';

const client = createClient({ url: process.env.REDIS_URL });

export interface GACheckpoint {
runId: string;
generation: number;
bestChromosome: Chromosome;
bestFitness: number;
hardViolations: number;
population: Chromosome[]; // Full population for true resume
history: number[];
avgHistory: number[];
candidates: PreGACandidate[];
checkpointedAt: string;
}

const CHECKPOINT_TTL_SECONDS = 3600; // 1 hour
const CHECKPOINT_INTERVAL = 10; // Every 10 generations

export async function saveCheckpoint(
runId: string,
checkpoint: GACheckpoint
): Promise<void> {
await client.setEx(
`ga:run:${runId}:checkpoint`,
CHECKPOINT_TTL_SECONDS,
JSON.stringify(checkpoint)
);
}

export async function loadCheckpoint(
runId: string
): Promise<GACheckpoint | null> {
const raw = await client.get(`ga:run:${runId}:checkpoint`);
return raw ? JSON.parse(raw) : null;
}

export async function clearCheckpoint(runId: string): Promise<void> {
await client.del(`ga:run:${runId}:checkpoint`);
}

export function shouldCheckpoint(generation: number): boolean {
return generation % CHECKPOINT_INTERVAL === 0;
}

Modified runGA.ts with checkpoint support:
export async function runGAWithCheckpoint(
candidates: PreGACandidate[],
lecturerStructuralMap: Map<number, boolean>,
config: GAConfig,
runId: string,
resumeFromCheckpoint = false
): Promise<GAResult> {

let population: Chromosome[];
let startGeneration = 0;
let history: number[] = [];
let avgHistory: number[] = [];

if (resumeFromCheckpoint) {
const checkpoint = await loadCheckpoint(runId);
if (checkpoint) {
population = checkpoint.population;
startGeneration = checkpoint.generation + 1;
history = checkpoint.history;
avgHistory = checkpoint.avgHistory;
console.log(`Resuming from generation ${startGeneration}`);
} else {
// Checkpoint expired or not found — start fresh
population = generateInitialPopulation(candidates, config.populationSize)
.map(ch => repairChromosome(ch, candidates));
}
} else {
population = generateInitialPopulation(candidates, config.populationSize)
.map(ch => repairChromosome(ch, candidates));
}

// ... rest of the GA loop with checkpoint saves:
for (let gen = startGeneration; gen < config.generations; gen++) {
// ... standard GA generation logic ...

    if (shouldCheckpoint(gen)) {
      await saveCheckpoint(runId, {
        runId,
        generation: gen,
        bestChromosome: overallBest!,
        bestFitness: overallBestFitness,
        hardViolations: overallHardViolations,
        population,
        history,
        avgHistory,
        candidates,
        checkpointedAt: new Date().toISOString(),
      });
    }

}

await clearCheckpoint(runId);
return { history, avgHistory, bestChromosome: overallBest!,
bestFitness: overallBestFitness,
hardViolations: overallHardViolations,
softPenalty: overallSoftPenalty };
}

HIGH: Stagnation Exit
Add to the generation loop in runGA.ts:
// Configuration constants — make these part of GAConfig in the future
const STAGNATION_WINDOW_GENERATIONS = 15;
const STAGNATION_IMPROVEMENT_THRESHOLD = 1e-6;

// State variables before the loop
let stagnationCounter = 0;
let lastRecordedBestFitness = -Infinity;
let stagnatedEarly = false;

// Inside the generation loop, after sorting:
const currentBest = evaluated[0]!;

if (currentBest.fitness - lastRecordedBestFitness > STAGNATION_IMPROVEMENT_THRESHOLD) {
// Genuine improvement — reset counter
stagnationCounter = 0;
lastRecordedBestFitness = currentBest.fitness;
} else {
stagnationCounter++;
}

// Only exit early if we are stagnating AND still have hard violations.
// If hard violations are zero, stagnation in soft optimization is acceptable.
if (
stagnationCounter >= STAGNATION_WINDOW_GENERATIONS &&
currentBest.hardViolations > 0
) {
console.warn(
`[GA] Stagnation detected at generation ${gen + 1}. ` +
`No improvement in ${STAGNATION_WINDOW_GENERATIONS} generations. ` +
`Best hard violations: ${currentBest.hardViolations}. ` +
`Terminating early.`
);
stagnatedEarly = true;
break;
}

Return stagnatedEarly as part of GAResult so the API can surface this to the frontend:
// In schedulerStore or SummaryPanel:
// If stagnatedEarly && hardViolations > 0, show warning:
// "GA terminated early due to stagnation. The schedule shown is the
// best achievable under current constraints but still has conflicts.
// Consider adding more time slots or reducing course load."

MEDIUM: Fisher-Yates Fix in mutateChromosome
Current implementation in mutation.ts:
// INCORRECT — biased permutation
const shuffled = [...candidate.possibleTimeSlotIds]
.sort(() => 0.5 - Math.random());

Corrected implementation:
// CORRECT — uniform permutation (matches chromosome.ts approach)
function fisherYatesShuffle<T>(arr: T[]): T[] {
const result = [...arr];
for (let i = result.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() \* (i + 1));
[result[i], result[j]] = [result[j]!, result[i]!];
}
return result;
}

export function mutateChromosome(
chromosome: Chromosome,
candidates: PreGACandidate[],
mutationRate: number
): Chromosome {
const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

return chromosome.map(gene => {
if (Math.random() >= mutationRate) return gene;

    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) return gene;

    const shuffled = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    return {
      ...gene,
      assignedTimeSlotIds: shuffled.slice(0, candidate.requiredSessions),
    };

});
}

MEDIUM: Audit Log — Prisma Migration
-- prisma/migrations/YYYYMMDD_add_ga_audit_log/migration.sql

CREATE TABLE "GARun" (
"id" TEXT NOT NULL PRIMARY KEY,
"status" TEXT NOT NULL DEFAULT 'RUNNING',
"configJson" TEXT NOT NULL,
"ssaResultJson" TEXT,
"currentGeneration" INTEGER NOT NULL DEFAULT 0,
"bestFitness" REAL NOT NULL DEFAULT 0,
"hardViolations" INTEGER NOT NULL DEFAULT 0,
"softPenalty" INTEGER NOT NULL DEFAULT 0,
"historyJson" TEXT NOT NULL DEFAULT '[]',
"avgHistoryJson" TEXT NOT NULL DEFAULT '[]',
"stagnatedEarly" BOOLEAN NOT NULL DEFAULT FALSE,
"durationMs" INTEGER,
"errorMessage" TEXT,
"createdBy" INTEGER,
"startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
"completedAt" DATETIME,
CONSTRAINT "GARun_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX "GARun_startedAt_idx" ON "GARun"("startedAt");
CREATE INDEX "GARun_status_idx" ON "GARun"("status");

Corresponding Prisma model:
model GARun {
id String @id @default(cuid())
status String @default("RUNNING")
configJson String
ssaResultJson String?
currentGeneration Int @default(0)
bestFitness Float @default(0)
hardViolations Int @default(0)
softPenalty Int @default(0)
historyJson String @default("[]")
avgHistoryJson String @default("[]")
stagnatedEarly Boolean @default(false)
durationMs Int?
errorMessage String?
createdBy Int?
startedAt DateTime @default(now())
completedAt DateTime?

user User? @relation(fields: [createdBy], references: [id], onDelete: SetNull)

@@index([startedAt])
@@index([status])
@@map("ga_runs")
}

MEDIUM: Constraint Conflict Visualizer UI Component
When SSA returns INFEASIBLE, the frontend must render an explanatory view rather than the empty scheduler state. Add to frontend/src/components/scheduler/:
// SSAFailurePanel.tsx
import { motion } from 'motion/react'
import { AlertOctagon, Network, Clock, DoorOpen, User } from 'lucide-react'
import type { SSAResult } from '@/types'

interface SSAFailurePanelProps {
ssaResult: SSAResult;
}

export function SSAFailurePanel({ ssaResult }: SSAFailurePanelProps) {
const { deadlockReport, totalSessionsRequired, maximumAchievableMatching } = ssaResult;
const gap = totalSessionsRequired - maximumAchievableMatching;

return (
<motion.div
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
className="max-w-2xl mx-auto mt-12 space-y-6" >
{/_ Header _/}
<div className="glass rounded-2xl p-6 border border-red-500/30 bg-red-500/8">
<div className="flex items-start gap-4">
<div className="p-3 rounded-xl bg-red-500/20 text-red-400 shrink-0">
<AlertOctagon size={24} />
</div>
<div>
<h2 className="text-lg font-bold text-red-300">
Structural Infeasibility Detected
</h2>
<p className="text-sm text-slate-400 mt-1">
The Genetic Algorithm was not executed. The current course and
resource configuration cannot produce a valid schedule.
</p>
</div>
</div>
</div>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{totalSessionsRequired}</p>
          <p className="text-xs text-slate-500 mt-1">Sessions Required</p>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{maximumAchievableMatching}</p>
          <p className="text-xs text-slate-500 mt-1">Maximum Schedulable</p>
        </div>
        <div className="glass rounded-xl p-4 text-center border border-red-500/30">
          <p className="text-2xl font-bold text-red-400">{gap}</p>
          <p className="text-xs text-slate-500 mt-1">Unresolvable Conflicts</p>
        </div>
      </div>

      {/* Explanation */}
      {deadlockReport && (
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Network size={16} className="text-primary-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              Deadlock Analysis
            </h3>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            {deadlockReport.message}
          </p>

          {/* Affected offerings */}
          {deadlockReport.affectedOfferingIds.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Affected Offering IDs
              </p>
              <div className="flex flex-wrap gap-2">
                {deadlockReport.affectedOfferingIds.map(id => (
                  <span key={id}
                    className="px-2.5 py-1 rounded-full text-xs font-mono
                               bg-red-500/15 border border-red-500/30 text-red-300">
                    #{id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommendation */}
          <div className="rounded-xl bg-primary-500/10 border border-primary-500/20 p-4">
            <p className="text-xs font-semibold text-primary-400 mb-1">
              Recommended Action
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">
              {deadlockReport.recommendation}
            </p>
          </div>
        </div>
      )}
    </motion.div>

);
}

Wire this into SchedulerPage.tsx:
// In SchedulerPage.tsx, add alongside the EmptyState check:
const { gaResult, ssaFailure } = useSchedulerStore();

// In the render:
{ssaFailure ? (
<SSAFailurePanel ssaResult={ssaFailure} />
) : !gaResult ? (
<EmptyState onGenerate={() => setConfigOpen(true)} />
) : (
// Normal schedule view
)}

Add ssaFailure to schedulerStore.ts:
// In SchedulerState interface:
ssaFailure: SSAResult | null;

// In setResults action, add ssaFailure reset:
setResults: (result, preGA, diversity, config) => {
set({ ssaFailure: null, ... });
},

// New action:
setSSAFailure: (result: SSAResult) => set({
ssaFailure: result,
isRunning: false,
runError: null
}),

11. Testing Strategy
    11.1 Layer-by-Layer Test Coverage Requirements
    Layer 1 (Pre-GA) — Unit Tests (existing, maintain coverage):
    The existing Vitest suite covers the six check functions. Ensure these scenarios are covered:
    Team-teaching offering (multiple lecturerIds) passes integrity check
    Blended class consolidation produces correct effectiveStudentCount
    Parallel split generates correct requiredSessions via room capacity formula
    Layer 2 (SSA) — Unit Tests (to be written):
    // ssa/ac3.test.ts

describe('AC-3 Constraint Propagation', () => {
it('detects forced conflict when two sessions share the only available slot', () => {
// Session A: room 1, only slot [1]
// Session B: room 1, only slot [1]
// → AC-3 should detect empty domain for one session
});

it('propagates domain reduction correctly', () => {
// Session A: room 1, slots [1, 2]
// Session B: room 1, only slot [1]
// → AC-3 removes slot 1 from A's domain (B is forced to use it)
// → A's domain becomes [2] — still consistent
});

it('passes when sessions share a room but have non-overlapping domains', () => {
// Session A: room 1, slots [1, 2]
// Session B: room 1, slots [3, 4]
// → No conflict possible, AC-3 returns consistent: true
});
});

// ssa/hopcroftKarp.test.ts

describe('Hopcroft-Karp Matching', () => {
it('finds perfect matching when one exists', () => {
// 3 sessions, 3 slots, each session can use exactly one unique slot
// → matching should be 3
});

it('detects infeasibility when matching is insufficient', () => {
// 3 sessions all competing for the same 2 slots
// → maximum matching is 2, not 3 → infeasible
});

it('correctly identifies unmatched sessions', () => {
// Verify unmatchedSessions array contains the correct session IDs
});
});

Layer 3 (GA) — Integration Tests:
// ga/integration.test.ts

describe('GA Integration — Easy Dataset', () => {
it('reaches hardViolations = 0 on easy dataset within 50 generations', async () => {
// Use seedEasy() dataset: 10 offerings, 5 rooms, 12 timeslots
// Run GA with standard config
// Assert: result.hardViolations === 0
});

it('respects elitism: best fitness never decreases between generations', () => {
// Assert: history[i+1] >= history[i] for all i
// (with lexicographic fitness this should always hold given elitism)
});
});

describe('GA Integration — Stagnation Exit', () => {
it('exits early when no valid schedule exists after SSA passes incorrectly', () => {
// Construct a pathological case that passes SSA but converges poorly
// Assert: stagnatedEarly === true in result
// Assert: run terminates before config.generations
});
});

11.2 White-Box Testing Targets (Thesis Requirement)
The thesis specifies white-box testing of the GA's internal logic. Map each GA component to a testable invariant:
Component
Invariant
Test Method
createRandomChromosome
Every generated chromosome has exactly requiredSessions slot IDs per gene
Assert gene.assignedTimeSlotIds.length === candidate.requiredSessions for all genes
repairChromosome
Post-repair chromosome never has duplicate slot IDs within a single gene
Assert new Set(gene.assignedTimeSlotIds).size === gene.assignedTimeSlotIds.length
evaluateHardFitness
A chromosome with no shared rooms or lecturers at any time slot always scores hardViolations = 0
Construct isolated assignments
tournamentSelection
Selected chromosome is always the highest-fitness in the tournament sample
Mock Math.random() to control sample selection
singlePointCrossover
Children contain no genes not present in either parent
Assert each child gene's offeringId exists in one of the parents
Elitism in runGA
First elitismCount members of new population are from previous generation's top-ranked
Assert identity (same object reference) for elites

11.3 Black-Box Testing Targets (Thesis Requirement)
Scenario
Input
Expected Output
Feasible simple case
5 offerings, ample rooms and slots
Valid schedule with 0 hard violations
Infeasible structural
3 offerings competing for 2 exclusive slots
SSA returns INFEASIBLE before GA runs
Partial infeasibility
20 offerings, 2 infeasible due to room mismatch
Pre-GA filters 2, GA runs on remaining 18
Parallel class handling
Offering with 60 students, room capacity 45
requiredSessions = 2, both sessions scheduled
Team teaching
Offering with 2 lecturers
Both lecturers blocked from other courses at same slot
Structural lecturer soft constraint
Offering with structural lecturer, 3+ sessions
Soft penalty > 0, reflected in fitness

12. Glossary
    Term
    Definition in this Context
    Chromosome
    A complete candidate timetable — one Gene per CourseOffering
    Gene
    The time slot assignment for one offering: { offeringId, assignedTimeSlotIds[] }
    Hard Constraint
    A rule that, if violated, renders the schedule invalid (room double-booking, lecturer double-booking)
    Soft Constraint
    A preference that is penalized but does not invalidate the schedule (structural lecturer overload)
    Pre-GA Candidate
    A CourseOffering that has passed all six Layer 1 checks and is ready for GA optimization
    Required Sessions
    ⌈effectiveStudentCount / roomCapacity⌉ — the number of time slots this offering must occupy
    SSA
    Static Structural Analysis — the deterministic feasibility gate that prevents GA from running on impossible inputs
    Hopcroft-Karp
    The O(E√V) maximum bipartite matching algorithm used to detect structural infeasibility
    AC-3
    Arc Consistency Algorithm 3 — constraint propagation that prunes impossible slot assignments before matching
    Elitism
    The policy of preserving the top n chromosomes from one generation to the next unchanged
    Stagnation
    A condition where the GA's best fitness does not improve by more than a threshold for N consecutive generations
    Repair
    A greedy post-crossover step that resolves hard constraint violations in a chromosome before fitness evaluation
    Lexicographic Fitness
    A fitness function where hard violations are strictly prioritized over soft penalties via non-overlapping numeric ranges
    Parallel Offering
    An offering split into multiple sessions because enrollment exceeds room capacity
    Blended Student
    A part-time (karyawan) student who is consolidated into a regular class when their cohort is under 10
