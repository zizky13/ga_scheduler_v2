# Technical Specification Document
## Universitas Pembangunan Jaya — Automatic Course Scheduling System
### arc42 Architecture Documentation | v2.0 (Aligned to PRD v6.0)

---

## 0. Document Preamble

| Field | Value |
|---|---|
| **Version** | 2.0 |
| **Status** | Living Document — Ready for Implementation |
| **PRD Baseline** | PRD v6.0 Final Edition |
| **Previous Version** | Tech Spec v1.0 (aligned to PRD v4.0) |
| **Primary Audience** | Mid-level to senior developers implementing this system |
| **Companion Documents** | Research Proposal (Proposal TA), PRD v6.0, Prisma Schema |

Sections marked `[ARCH-OBS-N]` are **Architect's Observations** — they flag ambiguities or gaps in the PRD with recommended technical resolutions. These are not optional notes; they represent decisions that must be made before the affected module can be implemented.

---

## 1. Introduction and Goals

### 1.1 The Problem Domain

Course timetabling is a **combinatorial NP-Hard problem**. This has been formally proven equivalent to graph coloring, meaning no known algorithm can solve it optimally in polynomial time as problem size grows. For UPJ's Faculty of Technology and Design, the search space for a single semester involves the cross-product of:

```
|Rooms| × |TimeSlots| × |Courses| × |Lecturers| × constraints
≈ 15 rooms × 45 slots/week × ~60 offerings × ~20 lecturers
≈ > 800,000 possible combinations before constraint filtering
```

A human with a spreadsheet explores this space heuristically and sequentially. This system explores it in parallel using evolutionary computation, but critically, it first uses deterministic analysis to prove that a valid solution *can exist* before wasting any computational resources on the search.

### 1.2 Business Goals

| Priority | Goal | Success Metric |
|---|---|---|
| P0 | Zero hard-constraint violations in the final schedule | `hardViolations === 0` in GA output |
| P0 | Prevent execution waste on infeasible inputs | SSA rejects infeasible datasets before GA runs |
| P0 | Respect manually locked room assignments throughout GA execution | `gene.roomId` for Fixed Room genes never changes across any generation |
| P1 | Minimize soft-constraint penalties | Weighted soft penalty minimized within valid solution space |
| P1 | Reduce scheduling processing time vs. manual | Time from data input to valid schedule `< 10 minutes` |
| P2 | Provide actionable conflict explanations | SSA error messages name the specific resources in deadlock |
| P2 | Allow iterative refinement by Kaprodi | Manual lock/override of individual entries post-generation |

### 1.3 UPJ-Specific Policy Goals (2025/2026 Ganjil)

The system must encode four non-negotiable UPJ academic policies as immutable constraints:

1. **Room allocation is proportional to enrolled students.** If `effectiveStudentCount > 45`, the offering is automatically split into parallel sessions (Sesi A and Sesi B) sharing one room across different time slots.
2. **Blended students integrate with regular classes** when a cohort has fewer than 10 registrants.
3. **Fixed-schedule offerings** (pinned by the faculty via the Lock Room UI) must never have their room assignment altered by the optimization engine.
4. **Team-teaching conflict prevention.** When an offering has multiple lecturers, all of them are blocked from any other concurrent assignment at the same time slot.

---

## 2. Architecture Constraints

### 2.1 Technical Constraints

| Constraint | Rationale |
|---|---|
| TypeScript throughout (backend + shared types) | Type safety is critical when modeling scheduling constraint graphs — a type error in a chromosome gene maps to a scheduling conflict at runtime. Discriminated unions enforce Fixed/Flexible gene masking at compile time. |
| Prisma ORM | Existing schema is Prisma-based (SQLite/libSQL); migrating would break the established migration history. |
| GA runs server-side only | Client devices (Kaprodi's laptop) cannot be trusted for consistent computation time; offloading to Node.js ensures reproducibility. |
| Redis for GA state persistence | GA runs can take 2–5 minutes; browser refreshes or network drops must not discard in-progress generations. |
| React frontend is read-only during GA execution | Race conditions between UI patches and in-progress chromosome evaluation are unacceptable. |
| `isFixedRoom` is a compile-time type discriminator, not a runtime boolean flag | TypeScript discriminated unions enforce at `tsc` time that Fixed Room genes never have their `roomId` mutated — this cannot be reliably enforced by scattered `if (gene.isFixedRoom)` checks. |
| Room locking must be committed before a run starts | Mid-run lock changes cause chromosome population inconsistency; the frontend must disable room lock edits once a run is in progress. |

### 2.2 Domain Constraints (UPJ Policy Layer)

- A lecturer may not be scheduled for more than one course at the same time slot — this includes all co-lecturers of team-taught offerings.
- Special rooms (LAB, Studio) are exclusive to courses that require them — general classrooms may never be substituted.
- **Lecturer competency match:** Every lecturer assigned to an offering must own at least one competency listed in that offering's `course.requiredCompetencies`. If `requiredCompetencies` is empty, the course imposes no competency restriction. This is a hard constraint of the same severity tier as locked-room conflicts and timeslot collisions; violations are infeasible. See `[HC-COMPETENCY]` in §4.3 for the formal definition.
- Structural lecturers (e.g., department heads) have a preferred maximum of 2 sessions per week — this is a soft constraint but must be tracked and penalized.
- Parallel offerings share a `parentOfferingId` — their room assignment is locked; only the time slot may vary between Sesi A and Sesi B.
- **Fixed Room offerings:** The `(Room, TimeSlot)` coordinate pair for a Fixed Room session locks the room permanently. The GA may only evolve the `TimeSlotID` dimension.
- **Flexible offerings:** The GA may evolve both `RoomID` and `TimeSlotID`, subject to facility compatibility constraints.

### 2.3 Political and Organizational Constraints

- The system is a **prototype for Fakultas Teknologi dan Desain only** — multi-faculty scheduling is explicitly out of scope for this iteration.
- Scheduling policy follows **Semester Ganjil 2025/2026** rules. Policy changes in subsequent semesters require a configuration update, not a code change.
- The Kaprodi retains **final approval authority** — the system is a decision-support tool, not an autonomous scheduler. No schedule is "published" without explicit user validation.

---

## 3. Context and Scope

### 3.1 System Context Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Context                             │
│                                                                      │
│   ┌───────────────┐           ┌──────────────────────────────────┐   │
│   │   Kaprodi     │ ─────────►│   GA Scheduler System            │   │
│   │  (Head of     │   HTTP    │                                  │   │
│   │   Program)    │◄───────── │  ┌──────────┐  ┌─────────────┐  │   │
│   └───────────────┘   JSON    │  │  React   │  │  Express    │  │   │
│                               │  │ Frontend │  │  API        │  │   │
│   ┌───────────────┐           │  └──────────┘  └─────────────┘  │   │
│   │  Academic     │ ─────────►│          ↓            ↓          │   │
│   │  Admin        │           │  ┌────────────────────────────┐  │   │
│   └───────────────┘           │  │ Three-Layer Pipeline       │  │   │
│                               │  │ Layer 1: Pre-GA Policy     │  │   │
│                               │  │ Layer 2: SSA Gatekeeper    │  │   │
│                               │  │ Layer 3: Hybrid GA Engine  │  │   │
│                               │  └────────────────────────────┘  │   │
│                               │          ↓            ↓          │   │
│                               │  ┌───────────┐  ┌──────────┐    │   │
│                               │  │ SQLite/   │  │  Redis   │    │   │
│                               │  │ libSQL    │  │  Cache   │    │   │
│                               │  └───────────┘  └──────────┘    │   │
│                               └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Scope Boundaries

**In scope:**
- CRUD management for all scheduling entities (rooms, lecturers, courses, offerings, time slots)
- Lock Room UI (FR-01): manual assignment of a fixed room to a specific offering
- Pre-GA policy transformation (blended consolidation, parallel splitting, entity tagging)
- Static Structural Analysis: Static Exclusion → AC-3 → Hopcroft-Karp bipartite matching
- Hybrid GA execution with Partial Gene Masking on Fixed Room genes
- Schedule visualization, conflict detection, manual override, lock mechanism
- SSA Conflict Traceback UI (FR-02): display of deadlock-causing resources
- CSV export of the final schedule
- Audit log of each GA run for thesis empirical validation

**Out of scope:**
- Multi-faculty scheduling
- Student timetable view
- Lecturer preference input UI (preferences are encoded at the constraint level)
- Integration with the university's existing academic information system (SIAK)
- Real-time collaborative editing (concurrent Kaprodi sessions)

---

## 4. Solution Strategy

### 4.1 The Three-Layer Pipeline

The core architectural decision is to **separate concerns into three sequential gates**. A schedule request must pass through all three layers in order. All three layers run in the same Node.js process but are logically and structurally decoupled — they communicate only through typed data structures.

```
[User Submits Run Request]
          │
          ▼
┌────────────────────────────┐
│  Layer 1: Data Sanitization│  Deterministic. Policy enforcement
│  & Policy Engine (Pre-GA)  │  + Entity Classification.
│                            │
│  Steps:                    │
│  1. Dynamic Consolidation  │  blended < 10 → merge to regular
│  2. Parallel Splitting     │  enrollment > 45 → Sesi A + Sesi B
│  3. 7 Constraint Checks    │  integrity, room, temporal, facility,
│     per offering           │  lecturer, competencies, academic policy
│  4. Entity Tagging (NEW)   │  isFixedRoom: true | false
│                            │
│  Output: PreGACandidate[]  │
│  tagged with isFixedRoom   │
│  Complexity: O(n)          │
└────────────┬───────────────┘
             │ feasible[] with isFixedRoom tags
             ▼
┌────────────────────────────┐
│  Layer 2: Static Structural│  Deterministic. Three-phase
│  Analysis (SSA) Gatekeeper │  infeasibility detection.
│                            │
│  Phase 0 (NEW):            │
│  Static Exclusion          │  Lock Fixed Room (Room, TimeSlot)
│                            │  coordinates. Prune them from
│                            │  Flexible candidates' domains.
│                            │
│  Phase 1:                  │
│  AC-3 Constraint           │  Domain reduction via constraint
│  Propagation               │  propagation. Abort if any domain
│                            │  becomes empty.
│                            │
│  Phase 2:                  │
│  Hopcroft-Karp Maximum     │  Global feasibility proof.
│  Bipartite Matching        │  If |matching| < |total sessions|,
│                            │  ABORT. Do not run GA.
│                            │
│  Complexity: O(E√V)        │
└────────────┬───────────────┘
             │ FEASIBLE signal only + pruned domains
             ▼
┌────────────────────────────┐
│  Layer 3: Hybrid Genetic   │  Probabilistic. Masked evolutionary
│  Algorithm (Optimization)  │  optimization.
│                            │
│  Guided Initialization:    │  Population seeded from SSA-validated
│                            │  domains (not random global space)
│                            │
│  Partial Gene Masking:     │
│  FIXED genes  → mutate     │  TimeSlotID only. RoomID immutable.
│  FLEXIBLE genes → mutate   │  Both RoomID + TimeSlotID.
│                            │
│  Masked Mutation:          │  Operator only touches TimeSlot
│  (FIXED genes)             │  locus. Compile-time enforced.
│                            │
│  Complexity: O(g × p × n)  │
└────────────────────────────┘
```

### 4.2 Technology Choice Rationale

**TypeScript Discriminated Unions for Gene Masking:**

The PRD v6.0 masking requirement must be enforced at the type level, not with runtime `if` checks scattered across crossover and mutation functions. The recommended pattern uses TypeScript discriminated unions:

```typescript
// ga/chromosome.ts

interface FixedRoomGene {
  kind: 'FIXED';
  offeringId: number;
  roomId: number;           // LOCKED — operators must never write this field
  assignedTimeSlotIds: number[];
}

interface FlexibleGene {
  kind: 'FLEXIBLE';
  offeringId: number;
  roomId: number;           // Mutable by GA operators
  assignedTimeSlotIds: number[];
}

export type Gene = FixedRoomGene | FlexibleGene;
export type Chromosome = Gene[];
```

Any function that attempts to write `gene.roomId` on a `FixedRoomGene` will produce a TypeScript error at `tsc` time because the type is narrowed by the `kind` discriminant. This makes the masking invariant structurally impossible to violate accidentally.

**TypeScript + Prisma for relational model safety:**

The scheduling domain model is deeply relational — offerings have lecturers, rooms have facilities, courses have requirements. Prisma-generated types create a compile-time contract between the DB schema and the GA engine, preventing the most common class of runtime bugs (field name mismatches, null/undefined propagation through candidate objects).

**Fisher-Yates for permutation operations:**

All shuffle operations must use Fisher-Yates. `Array.sort(() => Math.random() - 0.5)` produces biased permutations; Fisher-Yates guarantees uniform distribution, which is essential for unbiased initial population quality and correct mutation behavior.

**Conflict-aware repair post-crossover:**

The system applies a greedy repair step immediately after crossover, which dramatically accelerates convergence to `hardViolations = 0`. The tradeoff is that repair introduces a greedy bias — making this a **Lamarckian GA variant** — but this is the correct engineering decision given scheduling cycle time constraints. The thesis methodology section should describe this explicitly.

### 4.3 Fitness Function

PRD v6.0 mandates an explicit weighted formula:

$$Fitness = \frac{1}{1 + (\sum Penalty_{Hard} \times W_H) + (\sum Penalty_{Soft} \times W_S)}$$

Where:
- **Hard Penalty:** Lecturer time conflict, room-time conflict, parallel session conflict at the same slot, **lecturer–course competency mismatch** (Target: 0)
- **Soft Penalty:** Lecturer time preference violations, excessive teaching gaps

#### `[HC-COMPETENCY]` Lecturer–Course Competency Match

| Field | Value |
|---|---|
| **Constraint ID** | `HC-COMPETENCY` |
| **Name** | Lecturer–Course Competency Match |
| **Severity** | Hard — same tier as locked-room conflicts and timeslot collisions. Violations render the schedule infeasible. |
| **Reason Code** | `COMPETENCY_MISMATCH` (Pre-GA); `competencyMismatch` counter contributes to `hardViolations` (GA). |

**Formal definition.** Let `L = lecturer.competencies` and `R = course.requiredCompetencies`, both sets of strings. A lecturer–course pairing satisfies the constraint iff:

```
( R = ∅ )  ∨  ( L ∩ R ≠ ∅ )
```

That is: a course with no declared required competencies imposes no restriction (open assignment); otherwise the lecturer must own at least one of the required competencies. For a `CourseOffering` with multiple lecturers (team teaching), the constraint must hold for **every** assigned lecturer independently.

**Rationale.** Course quality assurance at UPJ requires that each instructor for an offering has demonstrable expertise in at least one core topic of the course. Without this gate, the GA can produce schedules that are structurally feasible (no resource collisions) but academically invalid — for example, assigning a lecturer with only `visual-design` competency to a `databases` course. Modelling the rule as a hard constraint propagates the academic-validity guarantee into the same dominance regime that already protects against double-booking.

**Enforcement layer.**

- **Primary gate (Pre-GA, Layer 1):** `checkCompetencies` in `src/pre-ga/checks.ts` rejects any `CourseOffering` whose assigned lecturer set violates the rule. The check sits between `checkLecturer` and `checkPolicy` in the sequential validator (`src/pre-ga/validator.ts`); a failure short-circuits the offering with reason code `COMPETENCY_MISMATCH` and the offering never reaches SSA or GA.
- **Defense-in-depth (GA, Layer 3):** `evaluateCompetencyMismatch` in `src/ga/fitness.ts` consumes a `CompetencyEligibilityMap` (`Map<offeringId, Set<eligibleLecturerId>>`) built once per pipeline run from the Lecturer/Course data. Any gene whose offering has eligible lecturers and whose `candidate.lecturerIds` contains a non-eligible lecturer contributes one violation per scheduled session; the count is summed into `hardViolations`. The map is threaded through `runGA` as an optional final argument, so calling code that omits it preserves backward compatibility (no-op).
- **SSA (Layer 2):** unchanged — SSA consumes already-filtered `PreGACandidate[]` and is therefore implicitly competency-correct by construction.

**Edge cases.**

- **`R = ∅` (open course):** `checkCompetencies` returns `OK` immediately; `evaluateCompetencyMismatch` records no entry in the eligibility map for that offering, which the evaluator treats as "open assignment" and skips.
- **Team teaching (`offering.lecturers.length > 1`):** every co-lecturer is checked independently; a single non-matching co-lecturer fails the offering at Pre-GA.
- **Empty `lecturer.competencies`:** the lecturer is eligible only for courses where `R = ∅`. For any course with a non-empty `R`, this lecturer fails the intersection test.
- **No eligible lecturer at all:** if no lecturer in the input set satisfies the constraint for an offering, the offering is rejected at Pre-GA with `COMPETENCY_MISMATCH`. The Kaprodi must either reassign lecturers, broaden the lecturer's `competencies`, or relax the course's `requiredCompetencies` — the system does not auto-resolve this.

**`[ARCH-OBS-01]`:** The weighted-sum formula, unlike the lexicographic scheme in v1.0, does not inherently guarantee that hard violations always dominate soft penalties. A perverse result — where a schedule with hard violations outranks a valid schedule due to low soft penalty — is possible if `W_H` is set too small. To prevent this while preserving the weighted formula, enforce the following minimum:

$$W_H \gg W_S \times \sum_{max} Penalty_{Soft}$$

**Recommended defaults: `W_H = 100`, `W_S = 1`**, with an expected soft penalty ceiling of ~50. This guarantees any chromosome with `hardViolations > 0` will always have a fitness below any chromosome with `hardViolations = 0`. Make these values configurable in `GAConfig`:

```typescript
export interface GAConfig {
  populationSize: number;
  generations: number;
  tournamentSize: number;
  mutationRate: number;
  elitismCount: number;
  crossover: CrossoverFn;
  hardPenaltyWeight: number;   // Default: 100
  softPenaltyWeight: number;   // Default: 1
}
```

---

## 5. Building Block View

### 5.1 Level 1 — System Module Map

```
ga_scheduler_lab/
├── frontend/                      # Presentation Layer
│   └── src/
│       ├── pages/                 # SchedulerPage, LoginPage
│       ├── components/
│       │   ├── scheduler/
│       │   │   ├── ScheduleGrid.tsx
│       │   │   ├── ConflictPanel.tsx
│       │   │   ├── GAConfigModal.tsx
│       │   │   ├── SSAFailurePanel.tsx    ← NEW (FR-02)
│       │   │   └── LockRoomModal.tsx      ← NEW (FR-01)
│       │   └── ...
│       ├── store/                 # Zustand (schedulerStore, authStore)
│       └── lib/api.ts             # Typed axios wrappers
│
└── src/
    ├── api/                       # Transport Layer
    │   ├── routes/                # scheduler.ts, offerings.ts, rooms.ts ...
    │   ├── services/              # scheduler.service.ts (orchestration)
    │   └── middleware/            # auth, authorize, errorHandler
    │
    ├── pre-ga/                    # Layer 1: Policy Engine
    │   ├── checks/                # integrity, room, temporal, facility, lecturer, competencies, policy
    │   ├── validator.ts           # runPreGA() orchestrator
    │   ├── candidate.ts           # PreGACandidate type (updated: isFixedRoom)
    │   └── entityTagger.ts        ← NEW: assigns isFixedRoom from LockedRoom table
    │
    ├── ssa/                       # Layer 2: Static Structural Analysis
    │   ├── staticExclusion.ts     ← NEW: Phase 0 — lock coordinates, prune domains
    │   ├── ac3.ts                 # Phase 1 — constraint propagation
    │   ├── bipartiteGraph.ts      # Graph construction
    │   ├── hopcroftKarp.ts        # Phase 2 — maximum matching algorithm
    │   └── index.ts               # runSSA() orchestrator
    │
    ├── ga/                        # Layer 3: Hybrid GA Core
    │   ├── chromosome.ts          # Gene discriminated union (FIXED | FLEXIBLE)
    │   ├── population.ts          # generateInitialPopulation
    │   ├── fitness.ts             # evaluateFitness (weighted formula W_H/W_S)
    │   ├── selection.ts           # tournamentSelection
    │   ├── mutation.ts            # mutateChromosome (masked: FIXED vs FLEXIBLE)
    │   ├── repair.ts              # repairChromosome (conflict-aware greedy)
    │   ├── diversity.ts           # checkDiversity (pre-run diagnostics)
    │   └── runGA.ts               # Main evolutionary loop (stagnation window: 100)
    │
    ├── crossovers/                # Crossover Operators (all must preserve gene.kind)
    │   ├── singlePoint.ts
    │   ├── uniform.ts
    │   └── partiallyMapped.ts
    │
    └── db/                        # Data Layer
        ├── client.ts              # Prisma singleton
        └── seed.ts                # Development data
```

### 5.2 Module Responsibilities

**Input Processor (`api/routes/`, `api/services/scheduler.service.ts`)**
Receives the run request, validates configuration parameters, and orchestrates the three-layer pipeline. `scheduler.service.ts` is the single point of entry for a scheduling run. It calls `runPreGA()` → `runSSA()` → `runGA()` in sequence, returning after SSA if infeasibility is detected.

**Feasibility Engine (`pre-ga/`, `ssa/`)**
The Pre-GA layer performs seven sequential checks per offering plus entity tagging. The SSA layer performs three-phase global feasibility analysis. Both layers are **pure functions** with no side effects beyond logging — they take typed data in, return a typed result.

**Hybrid GA Core (`ga/`, `crossovers/`)**
The evolutionary loop with clearly defined boundaries. The `runGA()` function takes `PreGACandidate[]` and a `GAConfig` object and returns a `GAResult`. It has no knowledge of Prisma or Express. This isolation is critical for testability and for the crossover comparison experiments required by the thesis.

**Persistence and Export (`api/services/`, `ssa/redis/`)**
Converts the winning chromosome back to human-readable `ScheduledEntry[]` objects via batch DB queries. Redis persistence checkpoints every 10 generations during a GA run.

### 5.3 Updated `PreGACandidate` Type

```typescript
// pre-ga/candidate.ts

export interface PreGACandidate {
  offeringId: number;
  courseCode: string;
  courseName: string;
  requiredSessions: number;
  roomId: number;
  roomCapacity: number;
  lecturerIds: number[];
  possibleTimeSlotIds: number[];
  isFixedRoom: boolean;           // NEW in v6.0 — set by entityTagger.ts
  possibleRoomIds?: number[];     // NEW (see ARCH-OBS-04) — for true flexible room opt
}
```

### 5.4 Entity Tagger (`pre-ga/entityTagger.ts`) — New Module

```typescript
// pre-ga/entityTagger.ts

import type { PreGACandidate } from './candidate.js';

/**
 * Tags each candidate with isFixedRoom based on whether the Kaprodi
 * has manually locked a room assignment via FR-01 (Lock Room UI).
 *
 * A locked room assignment means the GA may only vary the TimeSlotID
 * for this candidate — the RoomID is frozen for the entire evolutionary
 * process and is structurally enforced by the FixedRoomGene type.
 *
 * Source of truth: LockedRoom table in the DB, populated via FR-01 UI.
 */
export async function tagEntities(
  candidates: PreGACandidate[],
  lockedRoomMap: Map<number, number> // offeringId → lockedRoomId
): Promise<PreGACandidate[]> {
  return candidates.map(candidate => {
    const lockedRoomId = lockedRoomMap.get(candidate.offeringId);
    if (lockedRoomId !== undefined) {
      return {
        ...candidate,
        roomId: lockedRoomId,   // Overwrite with the locked room
        isFixedRoom: true,
      };
    }
    return { ...candidate, isFixedRoom: false };
  });
}
```

**Required Prisma schema addition:**

```prisma
model LockedRoom {
  id          Int            @id @default(autoincrement())
  offeringId  Int            @unique
  roomId      Int
  lockedBy    Int
  lockedAt    DateTime       @default(now())

  offering    CourseOffering @relation(fields: [offeringId], references: [id], onDelete: Cascade)
  room        Room           @relation(fields: [roomId], references: [id])
  user        User           @relation(fields: [lockedBy], references: [id])

  @@map("locked_rooms")
}
```

### 5.5 Competency Fields on `Lecturer` and `Course`

The competency hard constraint (`[HC-COMPETENCY]`, §4.3) is data-driven: it derives entirely from two new array-valued fields on the existing domain entities. No new entity is introduced; both fields live on records already loaded by the Layer 1 fetch.

```typescript
// types.ts (mirrors Prisma schema)

export interface Lecturer {
  id: number;
  name: string;
  isStructural: boolean;
  preferredTimeSlotIds: number[];
  competencies: string[];          // NEW — declared topics of expertise.
                                   // Cardinality: 0..N. Default: []. Free-form
                                   // strings curated by the Kaprodi (e.g.,
                                   // 'algorithms', 'databases', 'ai-ml').
                                   // An empty list means the lecturer is only
                                   // eligible for courses with no required
                                   // competencies.
}

export interface Course {
  id: number;
  code: string;
  name: string;
  sks: number;
  requiredFacilities: string[];
  requiredCompetencies: string[];  // NEW — competency tags a lecturer must own
                                   // at least one of to teach this course.
                                   // Cardinality: 0..N. Default: []. An empty
                                   // list disables the constraint for this
                                   // course (open assignment). Tag vocabulary
                                   // must align with `Lecturer.competencies`
                                   // — string equality is the matcher.
}
```

**Eligibility helper.** A single canonical predicate, `isLecturerEligibleForCourse(lecturer, course): boolean` in `src/pre-ga/checks.ts`, encodes the rule from §4.3 and is the **only** function permitted to compare these fields. Both Layer 1 (`checkCompetencies`) and the Layer 3 eligibility-map builder (in `src/cli/run-pipeline.ts`) consume it; downstream code must never re-implement the intersection check inline.

**Required Prisma schema addition:**

```prisma
model Lecturer {
  // ... existing fields ...
  competencies         String[]   // Postgres native; for SQLite, store as JSON string and parse at the repository boundary.
}

model Course {
  // ... existing fields ...
  requiredCompetencies String[]
}
```

**`[ARCH-OBS-05]`:** SQLite/libSQL has no native array column type. For the current Prisma target, persist these fields as `String` columns containing a JSON-encoded array and decode them at the repository boundary so the in-memory shape matches the TypeScript types above. The competency vocabulary is intentionally untyped (free-form `string`); a future enhancement could promote it to a `Competency` enum or a relational `LecturerCompetency` join table once the canonical taxonomy stabilises.

---

## 6. Runtime View

### 6.1 Complete Request Lifecycle

```
[POST /api/scheduler/run]
          │
          │  1. HTTP Request received
          ▼
[scheduler.service.ts::runScheduler()]
          │
          │  2. Fetch LockedRoom assignments from DB → build lockedRoomMap
          │
          │  3. Call runPreGA()
          ▼
[pre-ga/validator.ts::runPreGA()]
          │
          │  4. Fetch all CourseOfferings + relations from DB (single query)
          │  5. For each offering, run 7 sequential checks:
          │     integrity → roomCapacity → temporal → facility →
          │     lecturer → competencies → policy
          │  6. Partition into feasible[] and infeasible[]
          │  7. Fetch all TimeSlots from DB
          │  8. Build PreGACandidate[] for each feasible offering
          │  9. Call tagEntities() → stamp isFixedRoom on each candidate
          ▼
[IF feasible.length === 0]
          │  → Return 422 NO_FEASIBLE_CANDIDATES immediately
          │
[ELSE continue to SSA]
          │
          │  10. Call runSSA(candidates)
          ▼
[ssa/index.ts::runSSA()]
          │
          │  --- Phase 0: Static Exclusion ---
          │  11. Separate fixed[] and flexible[] candidates
          │  12. For each fixed candidate, register all (roomId, slotId)
          │      pairs as locked coordinates
          │  13. For each flexible candidate, remove locked coordinates
          │      from possibleTimeSlotIds where roomId matches
          │  → Output: prunedCandidates[] with reduced domains
          │
          │  --- Phase 1: AC-3 ---
          │  14. Build resource conflict pairs (room-sharing, lecturer-sharing)
          │  15. Propagate domain reductions via worklist
          │  16. If any session's domain.size === 0:
          │      → Return INFEASIBLE (AC3_DOMAIN_EMPTY)
          │      → GA is NOT called
          │
          │  --- Phase 2: Hopcroft-Karp ---
          │  17. Build bipartite graph: sessions (left) → slots (right)
          │  18. Run BFS + DFS augmenting path algorithm
          │  19. If maximumMatching < totalSessionsRequired:
          │      → Return INFEASIBLE (BIPARTITE_MATCHING_INSUFFICIENT)
          │      → GA is NOT called
          │
          │  → Return FEASIBLE + pruned candidate domains
          ▼
[IF SSA INFEASIBLE]
          │  → Return 422 with DeadlockReport
          │  → Frontend renders SSAFailurePanel (FR-02)
          │
[ELSE continue to GA]
          │
          │  20. checkDiversity(prunedCandidates) — diagnostic, non-blocking
          │  21. Build lecturerStructuralMap from DB
          │  21a. Build competencyEligibilityMap: for each feasible offering,
          │       compute Set<lecturerId> via isLecturerEligibleForCourse().
          │       Passed as the optional last argument to runGA() — used by
          │       evaluateCompetencyMismatch as defense-in-depth (`[HC-COMPETENCY]`).
          │
          ▼
[ga/runGA.ts::runGA()]
          │
          │  22. generateInitialPopulation() × populationSize
          │      → createChromosome(candidate) per individual:
          │        - If candidate.isFixedRoom → create FixedRoomGene (kind: 'FIXED')
          │        - Else → create FlexibleGene (kind: 'FLEXIBLE')
          │        - Fisher-Yates shuffle possibleTimeSlotIds
          │        - Slice to requiredSessions
          │      → repairChromosome() on every initial individual
          │
          │  23. For each generation (g = 0..generations):
          │
          │      a. evaluateFitness() for all chromosomes
          │         fitness = 1 / (1 + (hardPenalty × W_H) + (softPenalty × W_S))
          │         hardPenalty = collisionViolations + competencyMismatch
          │         → W_H default: 100, W_S default: 1
          │
          │      b. Sort population by fitness descending
          │      c. Log generation stats (best, avg, hardViolations, softPenalty)
          │      d. Copy top elitismCount chromosomes unchanged (elitism)
          │
          │      e. WHILE newPopulation.length < populationSize:
          │           parent1 = tournamentSelection()
          │           parent2 = tournamentSelection()
          │           [child1, child2] = crossover(parent1, parent2)
          │             → gene.kind is inherited from same locus in parent
          │             → FixedRoomGene.roomId is NEVER modified by crossover
          │           mutated1 = maskMutate(child1, mutationRate)
          │             → FIXED gene: new TimeSlotID only
          │             → FLEXIBLE gene: new TimeSlotID (+ RoomID when possibleRoomIds available)
          │           repaired1 = repairChromosome(mutated1)
          │           newPopulation.push(repaired1, repaired2)
          │
          │      f. Check stagnation (window: 100 generations, threshold: 1e-6)
          │         If stagnating AND hardViolations > 0 → early exit
          │
          │      g. population = newPopulation
          │
          │  24. Return GAResult: bestChromosome, history[], avgHistory[], stagnatedEarly
          ▼
[scheduler.service.ts]
          │
          │  25. chromosomeToEntries(bestChromosome, candidates)
          │      → Batch query offering details + TimeSlot objects
          │      → Map gene → ScheduledEntry (human-readable)
          │
          │  26. Persist GARun audit record to DB
          │  27. Return SchedulerResponse to HTTP client
          ▼
[Frontend]
          │  28. setResults() in schedulerStore
          │  29. Render ScheduleGrid, SummaryPanel, ConflictPanel
```

### 6.2 Layer 2 — SSA Runtime in Detail

**Why GA must not run if SSA fails:**

The GA explores the search space by sampling chromosomes. If the search space is empty — that is, no valid assignment of time slots to offerings can satisfy all hard constraints simultaneously — the GA will run for the full configured number of generations, produce chromosomes with `hardViolations > 0`, and return a result that is still invalid. This wastes 2–5 minutes of server computation time and misleads the user into thinking the problem is merely difficult rather than mathematically impossible.

The SSA determines, in `O(E√V)` time (vs. GA's `O(g × p × n)`), whether the feasible region is non-empty. It does this in three ordered phases.

#### Phase 0 — Static Exclusion (`ssa/staticExclusion.ts`)

```typescript
import type { PreGACandidate } from '../pre-ga/candidate.js';

export interface StaticExclusionResult {
  lockedCoordinates: Set<string>;   // Format: `${roomId}:${slotId}`
  prunedCandidates: PreGACandidate[];
}

/**
 * For every Fixed Room candidate, register the (Room, TimeSlot) coordinates
 * it WILL occupy as locked. Then remove those coordinates from the
 * possibleTimeSlotIds of any Flexible candidate sharing the same room.
 *
 * This must run BEFORE AC-3 and Hopcroft-Karp so that the bipartite graph
 * reflects the true available domain for flexible sessions.
 *
 * Without this phase, a flexible candidate might appear to have a valid
 * slot that is in fact pre-allocated to a fixed candidate, causing AC-3
 * and Hopcroft-Karp to report a false FEASIBLE result.
 */
export function runStaticExclusion(
  candidates: PreGACandidate[]
): StaticExclusionResult {
  const fixedCandidates = candidates.filter(c => c.isFixedRoom);
  const flexibleCandidates = candidates.filter(c => !c.isFixedRoom);

  const lockedCoordinates = new Set<string>();

  for (const fixed of fixedCandidates) {
    for (const slotId of fixed.possibleTimeSlotIds) {
      lockedCoordinates.add(`${fixed.roomId}:${slotId}`);
    }
  }

  const prunedFlexible: PreGACandidate[] = flexibleCandidates.map(flexible => ({
    ...flexible,
    possibleTimeSlotIds: flexible.possibleTimeSlotIds.filter(
      slotId => !lockedCoordinates.has(`${flexible.roomId}:${slotId}`)
    ),
  }));

  return {
    lockedCoordinates,
    prunedCandidates: [...fixedCandidates, ...prunedFlexible],
  };
}
```

#### Phase 1 — AC-3 Constraint Propagation (`ssa/ac3.ts`)

```typescript
import type { BipartiteGraph, SessionNode } from './bipartiteGraph.js';

export interface AC3Result {
  consistent: boolean;
  emptyDomainSessionId?: number;
  emptyDomainOfferingId?: number;
  reason?: string;
}

/**
 * Arc Consistency Algorithm 3 (AC-3)
 *
 * Prunes time slots from a session's domain if another session,
 * sharing the same room or a lecturer, is FORCED to use that slot
 * (i.e., it has no other option).
 *
 * If any session's domain becomes empty, the problem is immediately
 * infeasible — no matching can cover that session.
 *
 * Complexity: O(n²) worst case, O(n log n) typical for scheduling.
 */
export function runAC3(graph: BipartiteGraph): AC3Result {
  const { sessions, adjacency } = graph;

  const roomToSessions = new Map<number, SessionNode[]>();
  const lecturerToSessions = new Map<number, SessionNode[]>();

  for (const session of sessions) {
    if (!roomToSessions.has(session.roomId)) {
      roomToSessions.set(session.roomId, []);
    }
    roomToSessions.get(session.roomId)!.push(session);

    for (const lecturerId of session.lecturerIds) {
      if (!lecturerToSessions.has(lecturerId)) {
        lecturerToSessions.set(lecturerId, []);
      }
      lecturerToSessions.get(lecturerId)!.push(session);
    }
  }

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
        worklist.push([lecturerSessions[i]!.sessionId, lecturerSessions[j]!.sessionId]);
        worklist.push([lecturerSessions[j]!.sessionId, lecturerSessions[i]!.sessionId]);
      }
    }
  }

  while (worklist.length > 0) {
    const [xi, xj] = worklist.pop()!;
    const domainI = adjacency.get(xi);
    const domainJ = adjacency.get(xj);
    if (!domainI || !domainJ) continue;

    const sessionI = sessions.find(s => s.sessionId === xi)!;
    const sessionJ = sessions.find(s => s.sessionId === xj)!;

    const shareRoom = sessionI.roomId === sessionJ.roomId;
    const sharedLecturers = sessionI.lecturerIds
      .filter(id => sessionJ.lecturerIds.includes(id));

    if (!shareRoom && sharedLecturers.length === 0) continue;

    const toRemove: number[] = [];
    for (const slot of domainI) {
      if (domainJ.size === 1 && domainJ.has(slot)) {
        toRemove.push(slot);
      }
    }

    if (toRemove.length > 0) {
      for (const slot of toRemove) domainI.delete(slot);

      if (domainI.size === 0) {
        return {
          consistent: false,
          emptyDomainSessionId: xi,
          emptyDomainOfferingId: sessionI.offeringId,
          reason: `TEMPORAL_DEADLOCK: Offering ${sessionI.offeringId} session ` +
                  `${sessionI.sessionIndex} has no available time slots after ` +
                  `constraint propagation. All slots are needed by conflicting sessions.`,
        };
      }

      const relatedSessions = [
        ...(roomToSessions.get(sessionI.roomId) ?? []),
        ...sessionI.lecturerIds.flatMap(id => lecturerToSessions.get(id) ?? []),
      ].filter(s => s.sessionId !== xi);

      for (const related of relatedSessions) {
        worklist.push([related.sessionId, xi]);
      }
    }
  }

  return { consistent: true };
}
```

#### Phase 2 — Hopcroft-Karp Maximum Bipartite Matching (`ssa/hopcroftKarp.ts`)

```typescript
import type { BipartiteGraph } from './bipartiteGraph.js';

export interface MatchingResult {
  maximumMatching: number;
  sessionToSlot: Map<number, number>;
  slotToSession: Map<number, number>;
  unmatchedSessions: number[];
}

/**
 * Hopcroft-Karp Algorithm — Maximum Bipartite Matching
 *
 * Determines the maximum number of sessions that can be simultaneously
 * assigned to distinct time slots, respecting adjacency (domain) constraints.
 *
 * If maximumMatching < totalSessions, the problem is PROVABLY INFEASIBLE.
 * There is no valid complete timetable. GA must not run.
 *
 * Time Complexity: O(E × √V)
 *   E = total edges (sum of domain sizes across all sessions)
 *   V = total nodes (sessions + time slots)
 */
export function runHopcroftKarp(graph: BipartiteGraph): MatchingResult {
  const { sessions, adjacency } = graph;
  const INF = Infinity;

  const matchL = new Map<number, number>(sessions.map(s => [s.sessionId, -1]));
  const matchR = new Map<number, number>();

  for (const [, slots] of adjacency) {
    for (const slotId of slots) {
      if (!matchR.has(slotId)) matchR.set(slotId, -1);
    }
  }

  const dist = new Map<number, number>();
  let matching = 0;

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
        const pairedSession = matchR.get(slotId) ?? -1;
        if (pairedSession === -1) {
          foundAugmenting = true;
        } else if (dist.get(pairedSession) === INF) {
          dist.set(pairedSession, sessionDist + 1);
          queue.push(pairedSession);
        }
      }
    }
    return foundAugmenting;
  }

  function dfs(sessionId: number): boolean {
    const slots = adjacency.get(sessionId) ?? new Set<number>();
    const sessionDist = dist.get(sessionId)!;

    for (const slotId of slots) {
      const pairedSession = matchR.get(slotId) ?? -1;
      const canAugment = pairedSession === -1 ||
        (dist.get(pairedSession) === sessionDist + 1 && dfs(pairedSession));

      if (canAugment) {
        matchL.set(sessionId, slotId);
        matchR.set(slotId, sessionId);
        return true;
      }
    }

    dist.set(sessionId, INF);
    return false;
  }

  while (bfs()) {
    for (const session of sessions) {
      if (matchL.get(session.sessionId) === -1) {
        if (dfs(session.sessionId)) matching++;
      }
    }
  }

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
```

#### SSA Orchestrator (`ssa/index.ts`)

```typescript
import type { PreGACandidate } from '../pre-ga/candidate.js';
import { runStaticExclusion } from './staticExclusion.js';
import { buildBipartiteGraph } from './bipartiteGraph.js';
import { runAC3 } from './ac3.js';
import { runHopcroftKarp } from './hopcroftKarp.js';

export type SSAStatus = 'FEASIBLE' | 'INFEASIBLE';

export interface SSAResult {
  status: SSAStatus;
  totalSessionsRequired: number;
  maximumAchievableMatching: number;
  deadlockReport?: DeadlockReport;
}

export interface DeadlockReport {
  code: 'AC3_DOMAIN_EMPTY' | 'BIPARTITE_MATCHING_INSUFFICIENT';
  message: string;
  affectedOfferingIds: number[];
  recommendation: string;
}

export async function runSSA(candidates: PreGACandidate[]): Promise<SSAResult> {
  const totalSessionsRequired = candidates.reduce(
    (sum, c) => sum + c.requiredSessions, 0
  );

  // Phase 0: Static Exclusion
  const { prunedCandidates } = runStaticExclusion(candidates);

  // Phase 1: AC-3
  const graph = buildBipartiteGraph(prunedCandidates);
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
          ? [ac3Result.emptyDomainOfferingId] : [],
        recommendation:
          'Add more time slots or reduce the number of courses assigned to ' +
          'this lecturer/room combination.',
      },
    };
  }

  // Phase 2: Hopcroft-Karp
  const matchingResult = runHopcroftKarp(graph);

  if (matchingResult.maximumMatching < totalSessionsRequired) {
    const unmatchedOfferingIds = [
      ...new Set(
        matchingResult.unmatchedSessions.map(sessionId => Math.floor(sessionId / 100))
      ),
    ];

    return {
      status: 'INFEASIBLE',
      totalSessionsRequired,
      maximumAchievableMatching: matchingResult.maximumMatching,
      deadlockReport: {
        code: 'BIPARTITE_MATCHING_INSUFFICIENT',
        message:
          `Structural infeasibility: ${totalSessionsRequired} sessions required but only ` +
          `${matchingResult.maximumMatching} can be simultaneously assigned. ` +
          `${totalSessionsRequired - matchingResult.maximumMatching} session(s) unschedulable.`,
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
```

### 6.3 Layer 3 — Hybrid GA: Masked Genetic Operators

#### Chromosome Construction

```typescript
// ga/chromosome.ts

export interface FixedRoomGene {
  kind: 'FIXED';
  offeringId: number;
  roomId: number;            // IMMUTABLE — never written by operators
  assignedTimeSlotIds: number[];
}

export interface FlexibleGene {
  kind: 'FLEXIBLE';
  offeringId: number;
  roomId: number;            // Mutable by mutation operator
  assignedTimeSlotIds: number[];
}

export type Gene = FixedRoomGene | FlexibleGene;
export type Chromosome = Gene[];

export function createGeneFromCandidate(
  candidate: PreGACandidate,
  shuffledSlots: number[]
): Gene {
  const assignedTimeSlotIds = shuffledSlots.slice(0, candidate.requiredSessions);

  if (candidate.isFixedRoom) {
    return {
      kind: 'FIXED',
      offeringId: candidate.offeringId,
      roomId: candidate.roomId,
      assignedTimeSlotIds,
    };
  }

  return {
    kind: 'FLEXIBLE',
    offeringId: candidate.offeringId,
    roomId: candidate.roomId,
    assignedTimeSlotIds,
  };
}
```

#### Masked Mutation (`ga/mutation.ts`)

```typescript
import { fisherYatesShuffle } from './utils.js';
import type { Gene, Chromosome } from './chromosome.js';
import type { PreGACandidate } from '../pre-ga/candidate.js';

export function mutateChromosome(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  mutationRate: number
): Chromosome {
  const candidateMap = new Map(candidates.map(c => [c.offeringId, c]));

  return chromosome.map((gene): Gene => {
    if (Math.random() >= mutationRate) return gene;

    const candidate = candidateMap.get(gene.offeringId);
    if (!candidate) return gene;

    const shuffledSlots = fisherYatesShuffle(candidate.possibleTimeSlotIds);
    const newSlots = shuffledSlots.slice(0, candidate.requiredSessions);

    if (gene.kind === 'FIXED') {
      // MASKED: roomId is structurally immutable.
      // TypeScript enforces this — spreading FixedRoomGene and not
      // reassigning roomId makes it impossible to mutate accidentally.
      return {
        ...gene,
        assignedTimeSlotIds: newSlots,
      };
    }

    // FLEXIBLE: both roomId and timeSlotId are mutable.
    // Full room optimization requires possibleRoomIds[] — see ARCH-OBS-04.
    const newRoomId = candidate.possibleRoomIds?.length
      ? candidate.possibleRoomIds[
          Math.floor(Math.random() * candidate.possibleRoomIds.length)
        ]!
      : gene.roomId;

    return {
      ...gene,
      roomId: newRoomId,
      assignedTimeSlotIds: newSlots,
    };
  });
}
```

#### Crossover Masking Invariant

All three crossover operators (singlePoint, uniform, partiallyMapped) must preserve the `gene.kind` and `roomId` of Fixed Room genes. Add this runtime assertion guard for use in tests:

```typescript
// crossovers/utils.ts

export function assertMaskingInvariant(
  parent: Gene,
  child: Gene,
  locus: number
): void {
  if (process.env.NODE_ENV !== 'production') {
    if (parent.kind === 'FIXED') {
      if (child.kind !== 'FIXED' || parent.roomId !== child.roomId) {
        throw new Error(
          `MASKING VIOLATION at locus ${locus}: ` +
          `Fixed gene roomId changed from ${parent.roomId} to ${
            child.kind === 'FIXED' ? child.roomId : 'FLEXIBLE(kind changed)'
          }`
        );
      }
    }
  }
}
```

The key implementation rule for all crossover functions: **a child gene at locus `i` inherits its `kind` from the parent that contributed locus `i`.** Since both parents of any Fixed Room offering will have `kind: 'FIXED'` (the `kind` field derives from `isFixedRoom` on the candidate, which is fixed for the entire run), this invariant is naturally preserved as long as crossover does not swap gene metadata — only `assignedTimeSlotIds`.

#### Updated Fitness Function (`ga/fitness.ts`)

```typescript
export interface FitnessConfig {
  hardPenaltyWeight: number;   // W_H — default 100
  softPenaltyWeight: number;   // W_S — default 1
}

// Eligibility map: offeringId → Set of lecturerIds that satisfy [HC-COMPETENCY]
// for that offering's course. Built once per pipeline run from the
// Lecturer/Course data (see isLecturerEligibleForCourse). Empty/missing
// entries are interpreted as "open assignment" (no restriction).
export type CompetencyEligibilityMap = Map<number, Set<number>>;

export function evaluateFitness(
  chromosome: Chromosome,
  candidates: PreGACandidate[],
  lecturerStructuralMap: Map<number, boolean>,
  lecturerPreferenceMap: Map<number, Set<number>>,
  config: FitnessConfig,
  competencyEligibilityMap?: CompetencyEligibilityMap
): EvaluatedChromosome {
  const collisionViolations = evaluateHardFitness(chromosome, candidates);
  const competencyMismatch = evaluateCompetencyMismatch(
    chromosome, candidates, competencyEligibilityMap
  );
  const hardViolations = collisionViolations + competencyMismatch;

  const structuralPenalty = calculateStructuralPenalty(chromosome, candidates, lecturerStructuralMap);
  const preferencePenalty = calculatePreferencePenalty(chromosome, candidates, lecturerPreferenceMap);
  const softPenalty = structuralPenalty + preferencePenalty;

  const fitness = 1 / (
    1 +
    (hardViolations * config.hardPenaltyWeight) +
    (softPenalty * config.softPenaltyWeight)
  );

  return {
    chromosome, fitness, hardViolations, softPenalty,
    structuralPenalty, preferencePenalty, competencyMismatch,
  };
}
```

**`evaluateCompetencyMismatch` — defense-in-depth for `[HC-COMPETENCY]`.** Although the Pre-GA gate already filters infeasible offerings before they reach the GA, the GA fitness function still re-evaluates competency eligibility per gene. This is a deliberate redundancy: it protects against (a) future code paths that bypass Pre-GA and feed candidates directly into `runGA`, and (b) refactors that introduce a mutation operator capable of swapping `lecturerIds` between genes. The function iterates each gene's `candidate.lecturerIds`; for every lecturer not present in `competencyEligibilityMap.get(offeringId)`, it adds `gene.assignedTimeSlotIds.length` to the violation count — mirroring the per-session counting cadence already used by room/lecturer collisions. If `competencyEligibilityMap` is `undefined`, the function returns `0` (no-op), preserving callers that have not yet been migrated.

`EvaluatedChromosome` carries a new `competencyMismatch: number` counter alongside the existing `structuralPenalty` and `preferencePenalty` breakdowns, so the audit log can report the exact source of any non-zero `hardViolations` rather than a single opaque integer.

#### Stagnation Exit (Updated Window: 100 Generations)

```typescript
// In ga/runGA.ts — constants

const STAGNATION_WINDOW_GENERATIONS = 100;  // Updated from 15 (PRD v6.0 §4.2)
const STAGNATION_IMPROVEMENT_THRESHOLD = 1e-6;

// State before the loop
let stagnationCounter = 0;
let lastRecordedBestFitness = -Infinity;
let stagnatedEarly = false;

// Inside the generation loop, after evaluating and sorting:
if (currentBest.fitness - lastRecordedBestFitness > STAGNATION_IMPROVEMENT_THRESHOLD) {
  stagnationCounter = 0;
  lastRecordedBestFitness = currentBest.fitness;
} else {
  stagnationCounter++;
}

// Only exit early if stagnating AND hard violations remain unresolved.
// Stagnation during soft-constraint optimization is acceptable.
if (
  stagnationCounter >= STAGNATION_WINDOW_GENERATIONS &&
  currentBest.hardViolations > 0
) {
  console.warn(
    `[GA] Stagnation at generation ${gen + 1}. ` +
    `No improvement in ${STAGNATION_WINDOW_GENERATIONS} generations. ` +
    `Hard violations: ${currentBest.hardViolations}. Terminating.`
  );
  stagnatedEarly = true;
  break;
}
```

**Rationale for the 100-generation window:** With Fixed Room masking active, the GA's effective search space is structurally more constrained than a fully flexible problem. Fixed genes reduce the number of dimensions the optimizer can move in, which can create local optima that require more time to escape. The 15-generation window from Tech Spec v1.0 was calibrated for a fully flexible search space and would trigger false-positive stagnation exits in the hybrid scenario.

---

## 7. Deployment View

### 7.1 Process Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Server (Node.js Process)             │
│                                                      │
│  ┌────────────────┐    ┌──────────────────────────┐  │
│  │  Express API   │    │  Scheduling Pipeline      │  │
│  │  (port 3000)   │───►│                          │  │
│  │                │    │  Layer 1: Pre-GA + Tagger │  │
│  │  Rate limited: │    │  Layer 2: SSA (3 phases)  │  │
│  │  5 GA runs     │    │  Layer 3: Hybrid GA       │  │
│  │  per 5 min     │    │                          │  │
│  └────────────────┘    └──────────────────────────┘  │
│                                                      │
│  ┌────────────────┐    ┌──────────────────────────┐  │
│  │  SQLite/libSQL │    │  Redis                   │  │
│  │  (Prisma)      │    │  GA checkpoint cache     │  │
│  └────────────────┘    └──────────────────────────┘  │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                Client (Browser)                      │
│  React SPA (Vite, port 5173 in dev)                 │
│  Proxies /api → :3000                               │
└──────────────────────────────────────────────────────┘
```

**`[ARCH-OBS-02]`:** The GA currently runs synchronously in the Express request handler, blocking the Node.js event loop for the duration of the run (2–5 minutes). For a prototype with a single Kaprodi user, this is acceptable. For production, move the GA to a Worker Thread or a job queue (BullMQ + Redis) with SSE or WebSocket for progress updates.

### 7.2 Redis State Persistence Schema

```
Key:   ga:run:{runId}:checkpoint
TTL:   3600 seconds (1 hour)
Value: JSON {
  runId:               string,
  generation:          number,
  bestChromosome:      Chromosome,   // serialized
  bestFitness:         number,
  hardViolations:      number,
  population:          Chromosome[], // full population for true resume
  history:             number[],
  avgHistory:          number[],
  candidates:          PreGACandidate[],
  checkpointedAt:      ISO8601
}
```

Checkpoint frequency: every 10 generations. A resumed run re-hydrates the population from the saved state; the SSA result is not re-run on resume (it is cached separately as `ga:run:{runId}:ssa`).

---

## 8. Cross-cutting Concerns

### 8.1 Authentication and Authorization

| Role | Access |
|---|---|
| `ADMIN` | Full access to all endpoints including room/facility/timeslot management |
| `HEAD_OF_PROGRAM_STUDY` | Courses, lecturers, offerings, lock-room assignments, and scheduler endpoints |

All GA run requests require authentication. Unauthenticated access to GA endpoints would allow trivial CPU exhaustion attacks.

### 8.2 Audit Log

Every GA run must be persisted to the `GARun` table for thesis empirical validation (Chapter 4).

**Prisma schema addition:**

```prisma
model GARun {
  id               String    @id @default(cuid())
  status           String    @default("RUNNING")
  // 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STAGNATED' | 'SSA_INFEASIBLE'
  configJson       String    // GAConfig serialized
  ssaResultJson    String?   // SSAResult serialized (null if SSA passed)
  currentGeneration Int      @default(0)
  bestFitness      Float     @default(0)
  hardViolations   Int       @default(0)
  softPenalty      Int       @default(0)
  historyJson      String    @default("[]")
  avgHistoryJson   String    @default("[]")
  stagnatedEarly   Boolean   @default(false)
  durationMs       Int?
  errorMessage     String?
  createdBy        Int?
  startedAt        DateTime  @default(now())
  completedAt      DateTime?

  user             User?     @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([startedAt])
  @@index([status])
  @@map("ga_runs")
}
```

### 8.3 Error Handling Contract

All API errors use a standardized envelope:

```typescript
{
  success: false,
  error: {
    code: string,     // Machine-readable: 'NO_FEASIBLE_CANDIDATES',
                      // 'SSA_INFEASIBLE', 'AC3_DOMAIN_EMPTY',
                      // 'BIPARTITE_MATCHING_INSUFFICIENT',
                      // 'COMPETENCY_MISMATCH' (Pre-GA per-offering rejection)
    message: string,  // Human-readable for React ErrorToast
    details?: SSAResult  // Present when code is SSA-related
  }
}
```

### 8.4 Team Teaching Conflict Detection

The `evaluateHardFitness` function must iterate all `lecturerIds` per gene — not just the first — when building the lecturer-time conflict index. The `repairChromosome` function must similarly block a slot for **all** co-lecturers of an offering. Verify this in any refactoring:

```typescript
// Correct pattern in repair.ts — iterate ALL lecturers
for (const lecturerId of candidate.lecturerIds) {
  conflictIndex.get('lecturer')?.get(lecturerId)?.add(slotId);
}
```

### 8.5 Fisher-Yates Utility

All shuffle operations throughout the codebase must use the same utility:

```typescript
// ga/utils.ts

export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
```

**`[ARCH-OBS-03]`:** The current `mutateChromosome` uses `Array.sort(() => 0.5 - Math.random())` which produces biased permutations. Replace all occurrences with `fisherYatesShuffle`.

---

## 9. Frontend Additions (PRD v6.0 FR-01, FR-02)

### 9.1 Lock Room UI (FR-01 — `LockRoomModal.tsx`)

The Lock Room modal allows the Kaprodi to assign a fixed room to a specific offering before triggering a GA run. It must:

- Display a list of all CourseOfferings with current room assignments
- Allow selection of a room from a filtered list (compatible facilities + sufficient capacity)
- Write to `POST /api/locked-rooms` on save
- Disable room lock editing while a GA run is in progress (poll `/api/scheduler/status`)

### 9.2 SSA Failure Visualizer (FR-02 — `SSAFailurePanel.tsx`)

When SSA returns `INFEASIBLE`, replace the empty schedule grid with an explanatory panel:

```typescript
// frontend/src/components/scheduler/SSAFailurePanel.tsx

interface SSAFailurePanelProps {
  ssaResult: SSAResult;
}

export function SSAFailurePanel({ ssaResult }: SSAFailurePanelProps) {
  const { deadlockReport, totalSessionsRequired, maximumAchievableMatching } = ssaResult;
  const gap = totalSessionsRequired - maximumAchievableMatching;

  return (
    <div className="max-w-2xl mx-auto mt-12 space-y-6">

      {/* Header */}
      <div className="glass rounded-2xl p-6 border border-red-500/30 bg-red-500/8">
        <h2 className="text-lg font-bold text-red-300">
          Structural Infeasibility Detected — GA Not Executed
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          The current configuration cannot produce a valid schedule.
          The Genetic Algorithm was not run to prevent wasted computation.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Sessions Required" value={totalSessionsRequired} color="white" />
        <Stat label="Max Schedulable"   value={maximumAchievableMatching} color="green" />
        <Stat label="Unresolvable"      value={gap} color="red" />
      </div>

      {/* Deadlock report */}
      {deadlockReport && (
        <div className="glass rounded-2xl p-5 space-y-4">
          <p className="text-sm text-slate-400">{deadlockReport.message}</p>
          <div className="flex flex-wrap gap-2">
            {deadlockReport.affectedOfferingIds.map(id => (
              <span key={id} className="px-2.5 py-1 rounded-full text-xs font-mono
                                        bg-red-500/15 border border-red-500/30 text-red-300">
                Offering #{id}
              </span>
            ))}
          </div>
          <div className="rounded-xl bg-primary-500/10 border border-primary-500/20 p-4">
            <p className="text-xs font-semibold text-primary-400 mb-1">Recommended Action</p>
            <p className="text-sm text-slate-300">{deadlockReport.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Wire into `SchedulerPage.tsx`:**

```typescript
const { gaResult, ssaFailure } = useSchedulerStore();

return ssaFailure
  ? <SSAFailurePanel ssaResult={ssaFailure} />
  : !gaResult
    ? <EmptyState onGenerate={() => setConfigOpen(true)} />
    : <ScheduleGrid entries={gaResult.entries} />;
```

**Update `schedulerStore.ts`:**

```typescript
interface SchedulerState {
  ssaFailure: SSAResult | null;
  // ... existing fields
}

// Add action:
setSSAFailure: (result: SSAResult) => set({
  ssaFailure: result,
  isRunning: false,
  runError: null
}),

// Clear on new run:
setRunning: () => set({ isRunning: true, ssaFailure: null, gaResult: null }),
```

---

## 10. Testing Strategy

### 10.1 Layer Test Coverage Matrix

**Layer 1 (Pre-GA + Entity Tagger) — Unit Tests:**

| Test Scenario | Expected Outcome |
|---|---|
| Blended cohort < 10 | Merged into regular class; blended offering removed from candidates |
| Enrollment > 45 | Split into Sesi A + Sesi B with shared parentOfferingId |
| Team-teaching offering (multiple lecturerIds) | Passes integrity check; all lecturerIds present in candidate |
| Offering present in LockedRoom table | `isFixedRoom: true`, `roomId` overwritten with locked value |
| Offering absent from LockedRoom table | `isFixedRoom: false` |
| Lecturer competencies cover course requirements | `checkCompetencies` returns OK; offering forwarded to SSA |
| Lecturer competencies miss course requirements | Rejected with `COMPETENCY_MISMATCH`; offering excluded from candidates |
| Course with `requiredCompetencies = []` | `checkCompetencies` returns OK regardless of lecturer competencies (open assignment) |
| Team-teaching with one ineligible co-lecturer | Rejected with `COMPETENCY_MISMATCH`; per-lecturer evaluation, no quorum logic |

**Layer 2 (SSA) — Unit Tests:**

```
staticExclusion.test.ts
├── Locks correct (roomId, slotId) coordinates from fixed candidates
├── Removes locked coordinates from flexible candidates sharing the same room
├── Does not modify candidates in different rooms
└── Fixed candidates pass through unchanged

ac3.test.ts
├── Detects empty domain: two sessions in same room, both domain = [slot_1]
├── Propagates correctly: session A domain [1,2], session B domain [1] → A domain [2]
├── Returns consistent: true when sessions share room but non-overlapping domains
└── Handles team-teaching: lecturer conflict pruned same as room conflict

hopcroftKarp.test.ts
├── Returns perfect matching when one exists (n sessions, n unique slots)
├── Returns maximumMatching < n when n sessions compete for n-1 slots
├── Correctly identifies unmatchedSessions[] for error reporting
└── Handles empty adjacency (domain-less session) gracefully
```

**Layer 3 (Hybrid GA) — Unit + Integration Tests:**

```
chromosome.test.ts
├── createGeneFromCandidate: isFixedRoom=true → kind='FIXED'
├── createGeneFromCandidate: isFixedRoom=false → kind='FLEXIBLE'
└── Fisher-Yates: distribution test over 10,000 runs (chi-squared)

mutation.test.ts
├── FIXED gene: roomId unchanged after 1,000 mutations
├── FLEXIBLE gene: roomId changes when possibleRoomIds available
├── Both: assignedTimeSlotIds.length === candidate.requiredSessions post-mutation
└── Fisher-Yates used (no Array.sort bias)

crossover.test.ts (all three operators)
├── assertMaskingInvariant passes for all child genes
├── Children contain no offeringIds not present in parents
└── FixedRoomGene.roomId equals parent's roomId at same locus

fitness.test.ts
├── W_H=100: chromosome with 1 hard violation always scores < chromosome with 0 violations
├── Zero hard violations: fitness range is (0.5, 1.0)
├── Non-zero hard violations: fitness range is (0, 0.5]
├── Soft penalty correctly penalizes structural lecturer overload
├── evaluateCompetencyMismatch: undefined eligibility map → returns 0 (no-op)
├── evaluateCompetencyMismatch: ineligible lecturer → +N where N = scheduled sessions
└── competencyMismatch is summed into hardViolations (not softPenalty)

integration.test.ts
├── Easy dataset (10 offerings, ample slots): hardViolations=0 within 50 generations
├── Stagnation exit triggered when all generations produce same fitness
├── Fixed Room offerings: roomId unchanged across all generations and all runs
└── history[i+1] >= history[i] for all i (elitism invariant)
```

### 10.2 Black-Box Test Scenarios (Thesis Chapter 4)

| Scenario | Dataset | Expected |
|---|---|---|
| Feasible simple | 5 offerings, 10 slots, 5 rooms | `hardViolations = 0` |
| SSA Phase 0 trigger | 2 fixed offerings + 1 flexible, same room, 2 slots total | SSA INFEASIBLE — flexible has empty domain after exclusion |
| AC-3 abort | 2 sessions same room, both domain = [slot_1 only] | AC3_DOMAIN_EMPTY |
| Hopcroft-Karp abort | 3 sessions competing for 2 exclusive slots | BIPARTITE_MATCHING_INSUFFICIENT |
| Partial infeasibility | 20 offerings, 2 fail Pre-GA checks | GA runs on 18 only |
| Parallel class | 60-student offering, 45-capacity room | requiredSessions = 2, both scheduled |
| Team teaching | Offering with 2 lecturers | Both lecturers blocked at assigned slot |
| Fixed Room invariant | 5 offerings, 3 locked | Locked rooms unchanged across all 70 generations |
| Competency mismatch (Pre-GA) | Offering whose only lecturer has no overlap with `requiredCompetencies` | Pre-GA rejects with `COMPETENCY_MISMATCH`; offering does not reach SSA or GA |
| Competency open assignment | Offering whose course has `requiredCompetencies = []` | Pre-GA passes regardless of lecturer competencies |
| Crossover comparison | Same dataset × 3 crossover strategies | Thesis Table: fitness curves per strategy |

---

## 11. Architecture Decision Records (ADRs)

### ADR-01: Discriminated Union for Gene Masking (New in v2.0)

**Decision:** Use TypeScript discriminated unions (`kind: 'FIXED' | 'FLEXIBLE'`) rather than a runtime boolean flag.
**Rationale:** A scattered `if (candidate.isFixedRoom)` pattern is error-prone at scale — a developer adding a new mutation operator must remember to add the check. The discriminated union makes it structurally impossible to modify `roomId` on a `FixedRoomGene` without a compile error.
**Consequence:** All existing chromosome construction code must be refactored to use `createGeneFromCandidate()`.

### ADR-02: Three-Phase SSA (New in v2.0)

**Decision:** SSA executes Static Exclusion → AC-3 → Hopcroft-Karp in a strict order.
**Rationale:** Each phase reduces the problem for the next. Static Exclusion removes provably occupied slots from flexible domains before AC-3 processes them, which reduces the AC-3 worklist size. AC-3 reduces domain sizes before Hopcroft-Karp builds its bipartite graph, reducing `E` and therefore the O(E√V) cost.
**Consequence:** Phase 0 is a new module with no existing equivalent in the codebase. It must be implemented before AC-3 and Hopcroft-Karp are wired in.

### ADR-03: Weighted Fitness over Lexicographic (Changed in v2.0)

**Decision:** Use PRD v6.0's weighted formula `1 / (1 + hard×W_H + soft×W_S)` with `W_H=100, W_S=1`.
**Rationale:** The PRD mandates this formula. The large `W_H` default preserves the hard-violation dominance property of the previous lexicographic scheme while producing a continuous fitness landscape.
**Consequence:** The fitness chart's Y-axis is now continuous. Remove the "Hard violations resolved" annotation at `fitness = 2` from the `FitnessChart` component — it is no longer relevant.

### ADR-04: SSA as Hard Gate — GA Blocked if Any Phase Fails

**Decision:** If any SSA phase returns INFEASIBLE, the API returns 422 with a `DeadlockReport`. GA is not invoked.
**Rationale:** A GA run on an infeasible problem is mathematically guaranteed to produce an invalid result. Failing fast with actionable diagnostic information is strictly superior to running for 5 minutes and returning a "best" chromosome that still violates hard constraints.
**Consequence:** The `SSAFailurePanel` UI (FR-02) must be implemented to surface the `DeadlockReport` to the Kaprodi. An empty grid or generic error message is not acceptable.

### ADR-05: Stagnation Window = 100 Generations

**Decision:** The stagnation detection window is set to 100 generations, up from 15 in Tech Spec v1.0.
**Rationale:** Fixed Room masking reduces the GA's effective search space but can also create deeper local optima at the boundary between fixed and flexible genes. A 15-generation window calibrated for a fully flexible problem would trigger premature exit too frequently.
**Consequence:** Worst-case runtime with stagnation exit increases. This is acceptable given that the early exit only triggers when `hardViolations > 0` — the common case (valid schedule found) is unaffected.

---

## 12. Open Issues and Development Priorities

| Priority | Issue | Resolution | PRD Ref |
|---|---|---|---|
| **CRITICAL** | SSA Phase 0 (Static Exclusion) not implemented | Implement `ssa/staticExclusion.ts`; wire as first step in `runSSA()` | §2.2 |
| **CRITICAL** | SSA Phase 2 (Hopcroft-Karp) not implemented | Implement `ssa/hopcroftKarp.ts` | §2.2 |
| **CRITICAL** | Gene masking not implemented (no discriminated union) | Refactor `chromosome.ts`; update all mutation and crossover operators | FR-03 |
| **HIGH** | `possibleRoomIds[]` missing from `PreGACandidate` | Extend Layer 1 to populate room candidate list for Flexible offerings | `[ARCH-OBS-04]` |
| **HIGH** | Fitness function uses lexicographic scheme, not weighted formula | Implement `W_H=100, W_S=1` weighted formula with configurable params | §4.1 PRD v6.0 |
| **HIGH** | `LockedRoom` table not in Prisma schema | Add migration; build FR-01 Lock Room UI | FR-01 |
| **HIGH** | Redis checkpoint persistence not implemented | Implement checkpoint every 10 generations as specified in §7.2 | §2.2 |
| **MEDIUM** | Stagnation window is 15, PRD v6.0 specifies 100 | One-line constant change in `runGA.ts` | §4.2 |
| **MEDIUM** | Mutation uses biased `Array.sort()` shuffle | Replace with `fisherYatesShuffle` throughout | `[ARCH-OBS-03]` |
| **MEDIUM** | SSA Conflict Visualizer UI missing | Build `SSAFailurePanel` as specified in §9.2 | FR-02 |
| **MEDIUM** | `GARun` audit log table missing from schema | Add Prisma migration as specified in §8.2 | Research compliance |
| **LOW** | `assertMaskingInvariant` not wired into test suite | Add assertion calls in all crossover unit tests | FR-03 |
| **LOW** | GA blocks event loop during run | Refactor to Worker Thread (acceptable for prototype) | `[ARCH-OBS-02]` |
| **LOW** | `FitnessChart` has legacy `fitness=2` annotation | Remove annotation; update axis labels for continuous scale | ADR-03 |

---

## 13. Glossary

| Term | Definition in this Context |
|---|---|
| **Chromosome** | A complete candidate timetable — one `Gene` per `CourseOffering` |
| **Gene** | The time slot (and optionally room) assignment for one offering. Union type: `FixedRoomGene \| FlexibleGene` |
| **FixedRoomGene** | A gene where `roomId` is immutable for the entire GA run. `kind: 'FIXED'`. Enforced by TypeScript discriminated union. |
| **FlexibleGene** | A gene where both `roomId` and `assignedTimeSlotIds` may be evolved by GA operators. `kind: 'FLEXIBLE'` |
| **Partial Gene Masking** | The mechanism by which mutation and crossover operators only modify `TimeSlotID` for Fixed Room genes |
| **Hard Constraint** | A rule that, if violated, renders the schedule invalid (room double-booking, lecturer double-booking) |
| **Soft Constraint** | A preference that incurs a weighted penalty but does not invalidate the schedule (structural lecturer overload) |
| **Pre-GA Candidate** | A `CourseOffering` that has passed all seven Layer 1 checks and been tagged with `isFixedRoom`. Ready for SSA. |
| **Required Sessions** | `⌈effectiveStudentCount / roomCapacity⌉` — the number of time slots this offering must occupy |
| **Entity Tagging** | The Layer 1 step that stamps `isFixedRoom: true/false` onto each candidate based on the LockedRoom table |
| **Static Exclusion** | SSA Phase 0 — locks Fixed Room `(Room, TimeSlot)` coordinates and removes them from Flexible candidates' domains |
| **SSA** | Static Structural Analysis — the three-phase deterministic feasibility gate before GA runs |
| **AC-3** | Arc Consistency Algorithm 3 — constraint propagation that prunes impossible slot assignments |
| **Hopcroft-Karp** | O(E√V) maximum bipartite matching algorithm — provides the global feasibility proof |
| **Deadlock** | A structural infeasibility condition where no valid complete assignment exists. Detected by SSA. |
| **Elitism** | Preserving the top `n` chromosomes from one generation to the next unchanged |
| **Stagnation** | GA best fitness does not improve by `> 1e-6` for 100 consecutive generations while `hardViolations > 0` |
| **Repair** | Greedy post-crossover step resolving hard violations before fitness evaluation (Lamarckian GA variant) |
| **Parallel Offering** | An offering split into Sesi A and Sesi B because enrollment exceeds room capacity |
| **Blended Student** | A karyawan student consolidated into a regular class when their cohort size is under 10 |
| **Lamarckian GA** | A GA variant where repaired chromosomes (after greedy local search) replace their unrepaired parents |
| **Competency** | A free-form string tag (e.g., `algorithms`, `databases`) that appears on `Lecturer.competencies` (declared expertise) and `Course.requiredCompetencies` (teaching prerequisites). String equality is the matcher. |
| **`[HC-COMPETENCY]`** | The hard constraint requiring a non-empty intersection of `lecturer.competencies` and `course.requiredCompetencies` for every lecturer–offering pairing, unless the course's `requiredCompetencies` is empty. Enforced primarily at Pre-GA (`checkCompetencies`) and re-checked in the GA fitness function (`evaluateCompetencyMismatch`) as defense-in-depth. |
| **`COMPETENCY_MISMATCH`** | Reason code emitted by `checkCompetencies` when a lecturer assigned to an offering owns no competency listed in the course's `requiredCompetencies`. |
| **CompetencyEligibilityMap** | `Map<offeringId, Set<lecturerId>>` constructed once per pipeline run from the Lecturer/Course data and threaded into `runGA` so that `evaluateCompetencyMismatch` can flag any chromosome whose gene assigns a non-eligible lecturer. |
