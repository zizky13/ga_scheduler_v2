# ga_scheduler_v2

> A three-layer course scheduling engine for Universitas Pembangunan Jaya (UPJ) that combines deterministic feasibility analysis with a Genetic Algorithm to produce conflict-free class timetables.

This is the backend computation core for a final-year thesis ("Tugas Akhir") project. It implements the runtime described in `techspec_upj_scheduler_v2.md` (arc42 Tech Spec, aligned to PRD v6.0). The scope of this repository is the **algorithmic backbone only** — there is no Express API, Prisma client, Redis, or React UI in this codebase yet. Inputs come from an in-memory mock seed (`src/db/seed.ts`) and outputs are printed to the terminal by the CLI runners under `src/cli/`.

---

## Why This Exists

Course timetabling at UPJ's Faculty of Technology and Design is a combinatorial NP-Hard problem (search space ≈ 800,000+ combinations before constraint filtering). Running a Genetic Algorithm directly on bad inputs wastes minutes of compute and can return "best" schedules that still violate hard constraints. This project addresses that with a **three-layer pipeline** that proves a solution can exist _before_ searching for one:

1. **Layer 1 — Pre-GA Policy Engine** (deterministic, O(n)): seven per-offering checks (integrity, room capacity, temporal, facility, lecturer, **competencies**, policy), then entity tagging that marks each candidate as `Fixed Room` or `Flexible`. The competency check is the primary gate that filters out lecturer assignments whose declared expertise does not cover the course's required competencies.
2. **Layer 2 — Static Structural Analysis / SSA** (deterministic, O(E√V)): static exclusion of locked `(room, slot)` coordinates, AC-3 constraint propagation, and Hopcroft–Karp maximum bipartite matching as a global feasibility proof.
3. **Layer 3 — GA Core** (probabilistic, O(g × p × n)): an evolutionary loop with `Fixed`/`Flexible` masked gene operators, three swappable crossover strategies (`singlePoint`, `uniform`, `pmx`), repair, mutation, tournament selection, elitism, and stagnation-based early exit.

A core design rule (encoded as a TypeScript discriminated union in `src/types.ts`) is that **`Fixed Room` genes must never have their `roomId` mutated by GA operators** — only the time-slot dimension may evolve.

---

## Tech Stack

- **Language:** TypeScript (strict mode, `target: ES2022`, `module: NodeNext`)
- **Runtime:** Node.js, executed via [`tsx`](https://tsx.is/) (no compilation step required for the CLI runners)
- **Package type:** `commonjs` (per `package.json`), but source uses `.js`-suffixed ESM-style relative imports compatible with `NodeNext` resolution
- **Dev dependencies:** `tsx`, `typescript`, `@types/node`
- **Runtime dependencies:** none — the algorithmic core is pure, dependency-free TypeScript

> The full system described in the tech spec also targets Prisma (SQLite/libSQL), Redis, Express, and React — none of those are wired into this repository yet.

---

## Prerequisites

- **Node.js** — any modern LTS that supports the `tsx` runtime (Node 18+ recommended; the project uses `@types/node` ^25)
- **npm** (ships with Node.js)

---

## Installation

Clone the repository, then install dev dependencies:

```bash
npm install
```

There is no build step required to run any of the CLI scripts — `tsx` executes the TypeScript sources directly.

---

## Configuration

There are **no environment variables or config files** required to run this codebase as-is.

GA hyperparameters (`populationSize`, `generations`, `mutationRate`, `elitismCount`, `tournamentSize`, `crossoverType`, `noiseRate`, `hardPenaltyWeight`, `softPenaltyWeight`) are passed as a `GAConfig` object directly inside each CLI runner. The current values are hard-coded in:

- `src/cli/run-layer3.ts` — single GA run (population 50, 100 generations, `singlePoint` crossover)
- `src/cli/run-pipeline.ts` — full pipeline, runs all three crossover strategies (population 80, 200 generations)

Edit those files to tune the run.

The mock dataset (rooms, time slots, lecturers, courses, course offerings, and a small set of intentionally infeasible offerings used to exercise Layer 1 rejections) lives in `src/db/seed.ts`. The seed now carries competency tags: 8 lecturers with `competencies` (e.g., `algorithms`, `databases`, `ai-ml`) and 11 courses with `requiredCompetencies`. Replace this file when wiring real data sources.

---

## Available Scripts

Defined in `package.json`:

| Script     | Command            | What it does                                                                                                                                                                                                            |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layer1`   | `npm run layer1`   | Runs the Pre-GA validator end-to-end on the mock seed (feasible + infeasible offerings) and prints validation results, candidates, and the entity tagger summary.                                                       |
| `layer2`   | `npm run layer2`   | Runs the SSA layer in isolation across five test scenarios: a feasible dataset, Phase 0 static exclusion verification, a forced Hopcroft–Karp infeasibility, an AC-3 forced conflict, and a Phase 0 + AC-3 elimination. |
| `layer3`   | `npm run layer3`   | Runs Layer 1 → Layer 2 → Layer 3 (single GA run) and prints the best chromosome, fitness history, and validation status.                                                                                                |
| `pipeline` | `npm run pipeline` | Full three-layer orchestrator. Runs the GA across all three crossover strategies (`singlePoint`, `uniform`, `pmx`) against the same inputs and prints a comparative summary plus the final schedule from the PMX run.   |
| `test`     | `npm test`         | **Not implemented** — the script is a placeholder that exits with an error. (`TODO`: wire up a real test runner.)                                                                                                       |

Each script is just `npx tsx src/cli/<file>.ts`, so you can also run them directly with `npx tsx ...` if you prefer.

---

## Project Structure

```
ga_scheduler_v2/
├── package.json                      # scripts + tsx/typescript dev deps
├── tsconfig.json                     # strict TS, NodeNext, outDir ./dist
├── technical_spec.md                 # arc42 Tech Spec v1.0 (aligned to PRD v4.0)
├── techspec_upj_scheduler_v2.md      # arc42 Tech Spec v2.0 (aligned to PRD v6.0) — current
└── src/
    ├── types.ts                      # All shared domain types (entities, GA config, results)
    ├── cli/
    │   ├── run-layer1.ts             # CLI: Pre-GA only
    │   ├── run-layer2.ts             # CLI: SSA only (with multiple infeasibility scenarios)
    │   ├── run-layer3.ts             # CLI: full pipeline, single GA run
    │   └── run-pipeline.ts           # CLI: full pipeline, all three crossover strategies
    ├── db/
    │   └── seed.ts                   # Mock rooms, slots, lecturers, courses, offerings
    ├── pre-ga/                       # Layer 1
    │   ├── checks.ts                 # 7 validation checks (incl. checkCompetencies + isLecturerEligibleForCourse)
    │   ├── validator.ts              # Orchestrator + PreGACandidate construction
    │   └── entityTagger.ts           # Stamps isFixedRoom from lockedRoomMap
    ├── ssa/                          # Layer 2
    │   ├── index.ts                  # SSA orchestrator (Phase 0 → AC-3 → Hopcroft–Karp)
    │   ├── staticExclusion.ts        # Phase 0: prune locked (room, slot) coordinates
    │   ├── bipartiteGraph.ts         # Build session ↔ slot adjacency
    │   ├── ac3.ts                    # Phase 1: AC-3 constraint propagation
    │   └── hopcroftKarp.ts           # Phase 2: maximum bipartite matching
    └── ga/                           # Layer 3
        ├── chromosome.ts             # Gene factories (FIXED / FLEXIBLE)
        ├── population.ts             # Initial population generation
        ├── selection.ts              # Tournament selection
        ├── crossover.ts              # singlePoint, uniform, pmx
        ├── mutation.ts               # Slot mutation (room mutation only on FLEXIBLE genes)
        ├── repair.ts                 # Post-operator chromosome repair
        ├── fitness.ts                # Weighted fitness: 1 / (1 + W_H·hard + W_S·soft); includes evaluateCompetencyMismatch (defense-in-depth)
        └── runGA.ts                  # Main evolutionary loop with stagnation exit; threads optional CompetencyEligibilityMap into fitness
```

The `dist/` directory referenced in `tsconfig.json` is a build output target and is not produced by any of the npm scripts above (the runners execute via `tsx` directly).

---

## How the Layers Connect

```
seed.ts                         <-- mock input data
   │
   ▼
runPreGA(offerings, slots)      <-- Layer 1 (src/pre-ga/validator.ts)
   │   produces: { validation, candidates: PreGACandidate[] }
   │   competency filtering happens here (checkCompetencies, primary gate)
   ▼
runSSA(candidates)              <-- Layer 2 (src/ssa/index.ts)
   │   produces: SSAResult { status: 'FEASIBLE' | 'INFEASIBLE', ... }
   │   gates GA execution; returns DeadlockReport if INFEASIBLE
   ▼
runGA(candidates, structuralMap, preferenceMap, config, competencyEligibilityMap?)
   │                                                  <-- Layer 3 (src/ga/runGA.ts)
       produces: GAResult { bestChromosome, bestFitness, hardViolations, softPenalty, history, ... }
       defense-in-depth: evaluateCompetencyMismatch contributes to hardViolations
```

### Eligibility rule (competency match)

A lecturer is **eligible** for a course iff the intersection of `lecturer.competencies` and `course.requiredCompetencies` contains at least one element. If `course.requiredCompetencies` is empty (`[]`), any lecturer is eligible (no restriction). The helper `isLecturerEligibleForCourse(lecturer, course)` lives in `src/pre-ga/checks.ts` and is reused by the CLI to build the `CompetencyEligibilityMap` passed to the GA.

`SchedulerResponse` in `src/types.ts` is the orchestration return type intended to wrap all three layers; the CLI runners currently print directly rather than returning this struct, but the type is in place for downstream API integration.

---

## Spec Documents

For the full domain rationale, architecture decisions, constraint catalogue, complexity analysis, and ARCH-OBS observations, read the spec docs at the repository root:

- `techspec_upj_scheduler_v2.md` — **current** spec (v2.0, aligned to PRD v6.0). Start here.
- `technical_spec.md` — earlier v1.0 of the same document, kept for reference.

These cover topics that are intentionally **not** repeated in this README, including:

- The full UPJ academic policy layer (parallel splitting, blended cohorts, structural lecturer caps, team-teaching constraints)
- Why `isFixedRoom` is a compile-time discriminated union rather than a runtime flag
- The AC-3 + Hopcroft–Karp interplay and the worked examples behind each
- The weighted fitness formula and the rationale for `W_H = 100`, `W_S = 1`
- Stagnation detection (`STAGNATION_WINDOW = 100`) and early-exit semantics
- The intended Prisma schema, Redis state model, and Express API surface (not yet implemented in this repo)

The spec docs are written primarily in English with some Indonesian terminology (e.g., _Kaprodi_, _Sesi A/B_, _Semester Ganjil_) where it reflects UPJ's institutional vocabulary.

---

## Roadmap / Backlog

**How to use this roadmap.** Tick the checkboxes as work lands; phases are roughly sequential because later phases depend on earlier ones (no API without persistence, no live progress without a queue), but individual items can move across phases if priorities shift. Each item is tagged with a priority (`P0` blocker / `P1` important / `P2` nice-to-have) and a rough size (`S` < 1 day, `M` 1–3 days, `L` ~1 week, `XL` > 1 week). Spec references point at the source of truth.

### Phase 0 — Algorithmic Core Hardening

No new infrastructure. Everything below can ship against the current `tsx`-only repo and the in-memory seed.

- [x] `[P0/S]` Bump `STAGNATION_WINDOW` from 15 to 100 in `src/ga/runGA.ts` to match PRD v6.0 (techspec §12 MEDIUM, §4.2, ADR-05).
- [x] `[P0/S]` Replace any biased `Array.sort(() => Math.random() - 0.5)` shuffle with a `fisherYatesShuffle` helper across `src/ga/mutation.ts`, `src/ga/crossover.ts`, and `src/ga/population.ts` (techspec §12 MEDIUM, `[ARCH-OBS-03]`).
- [x] `[P0/S]` Add `competencyMismatch: number` to `EvaluatedChromosome` and `GAResult` in `src/types.ts`; thread it through `src/ga/fitness.ts` and `src/ga/runGA.ts` so the audit counter is exposed end-to-end (api_design §3.2, §5.3.8, §8).
- [x] `[P0/S]` Add `hardPenaltyWeight` and `softPenaltyWeight` (defaults `100` / `1`) to `GAConfig` in `src/types.ts` and consume them in `src/ga/fitness.ts` instead of inline constants (techspec §4.3 `[ARCH-OBS-01]`, api_design §5.3.8 GAConfig truth-table note).
- [ ] `[P0/M]` Wire up a real test runner (`vitest` or `node --test`) and replace the stubbed `npm test` script in `package.json`. Carry over the existing `TODO` for tests.
- [ ] `[P0/M]` Implement `assertMaskingInvariant(parent, child)` and call it from every crossover unit test in `tests/ga/crossover.test.ts` (techspec §10, §12 LOW, FR-03).
- [ ] `[P1/M]` Add Layer 1 unit tests covering all eight `checkCompetencies` scenarios in techspec §10.1 (eligible, ineligible, empty `requiredCompetencies`, team-teaching with one ineligible co-lecturer, etc.).
- [ ] `[P1/M]` Add Layer 2 unit tests for `staticExclusion`, `ac3`, and `hopcroftKarp` matching the test outline in techspec §10.1.
- [ ] `[P1/M]` Add Layer 3 integration tests: easy-dataset convergence, stagnation exit, Fixed Room invariant across generations, elitism monotonicity (techspec §10.1).
- [ ] `[P1/S]` Verify `possibleRoomIds[]` is populated on every `PreGACandidate` for Flexible offerings; if missing, extend `src/pre-ga/validator.ts` (techspec §12 HIGH, `[ARCH-OBS-04]`).
- [ ] `[P1/S]` Add a `LICENSE` file at the repo root matching `package.json`'s `ISC` field (or change the field). Carries over the existing README `TODO`.
- [ ] `[P2/S]` Fill in `author`, `description`, `keywords`, and `repository` in `package.json`. Carries over the existing README `TODO`.
- [ ] `[P2/M]` Refactor `src/cli/run-pipeline.ts` and `src/cli/run-layer3.ts` to return a `SchedulerResponse` instead of printing inline, so the CLIs share the type the future API will return.

### Phase 1 — Persistence Layer

Introduce Prisma. The GA core stays Prisma-unaware; a new repository boundary adapts rows to the plain TS types in `src/types.ts` (api_design §3.5).

- [ ] `[P0/M]` Add `prisma`, `@prisma/client`, and `bcrypt` dependencies; initialize `prisma/schema.prisma` from the schema in api_design §3.2.
- [ ] `[P0/M]` Generate the initial migration covering `User`, `RefreshToken`, `Semester`, `Facility`, `Room`, `RoomFacility`, `TimeSlot`, `Lecturer`, `LecturerPreferredSlot`, `Course`, `CourseRequiredFacility`, `CourseOffering`, `CourseOfferingLecturer`, `CourseOfferingFixedSlot` (api_design §3.2).
- [ ] `[P0/M]` Add the `LockedRoom` table migration and its indexes (techspec §5.4, §12 HIGH, FR-01; api_design §3.2).
- [ ] `[P0/M]` Add the `ScheduleRun`, `ScheduleAssignment`, `ScheduleAssignmentSlot`, `FitnessHistory`, `AuditLog` tables — including the `competencyMismatch` audit column on both `ScheduleRun` and `FitnessHistory` (techspec §8.2, §12 MEDIUM; api_design §3.2).
- [ ] `[P0/M]` Implement the dual-target encoding rule for `Lecturer.competencies` and `Course.requiredCompetencies`: native `String[]` on Postgres, JSON-encoded `String` on SQLite, decoded at the repository boundary (techspec `[ARCH-OBS-05]`; api_design §3.5).
- [ ] `[P1/M]` Port `src/db/seed.ts` to a Prisma seed script that upserts a single `Semester` (`2025-GANJIL`) plus the existing rooms / slots / lecturers / courses / offerings; gate `infeasibleOfferings` behind `--with-infeasible` (api_design §3.5). Carries over the existing README `TODO` about the production data source.
- [ ] `[P1/M]` Build a thin repository layer (`src/repo/*.ts`) that returns `Room`, `Lecturer`, `Course`, `CourseOffering`, `LockedRoom` shaped exactly like `src/types.ts` so `runPreGA`, `runSSA`, `runGA` continue to consume plain TS types.
- [ ] `[P1/S]` Document `OQ-3` (Postgres vs SQLite) decision and pin the Prisma `provider` accordingly; update `prisma/schema.prisma` and the README config section.

### Phase 2 — API & Auth

Express transport over the existing pipeline. No GA logic changes; only routing, validation, RBAC, audit.

- [ ] `[P0/L]` Scaffold `src/api/server.ts` with Express, JSON body parsing, `requestId` middleware, pino logging, and the centralized error envelope from api_design §6.
- [ ] `[P0/L]` Implement Zod schemas under `src/api/schemas/*` and route handlers under `src/api/routes/*`. One schema per route; reuse `competencyArraySchema` for both lecturer and course bodies (api_design §6).
- [ ] `[P0/L]` Implement `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` with bcrypt (cost 12), HS256 JWT (15-min access), and opaque rotated refresh tokens (7-day, hashed in `RefreshToken`) per api_design §4.
- [ ] `[P0/M]` Implement `requireAuth`, `requireRole`, `requireOwnerOrAdmin`, `allowFields`, `rateLimitAuth`, `rateLimitRun` middleware (api_design §4.6).
- [ ] `[P0/L]` Implement CRUD routes for `users`, `semesters`, `rooms`, `timeslots`, `facilities`, `locked-rooms` per api_design §5.3.2–§5.3.4. Honor the permission matrix in §4.5 exactly.
- [ ] `[P0/L]` Implement CRUD for `lecturers`, `courses`, `course-offerings` including the field-level rules in api_design §4.5 and §4.6 (`isStructural` / `isFixed` / `fixedTimeSlotIds` admin-only). Surface `competencies` and `requiredCompetencies` as editable by both roles (api_design §5.3.5–§5.3.7).
- [ ] `[P0/M]` Wire the `COMPETENCY_MISMATCH` per-offering rejection into the `preGASummary.infeasible[]` payload (not as a top-level run failure) per api_design §5.2; emit `NO_FEASIBLE_CANDIDATES` only when every offering is rejected.
- [ ] `[P1/M]` Implement `AuditLog` writes from every state-changing endpoint with `before` / `after` diffs, request-id propagation, and redacted password hashes (api_design §8).
- [ ] `[P1/S]` Implement `GET /health` and `GET /ready` (DB + Redis pings) per api_design §5.3.9.
- [ ] `[P1/M]` Generate an OpenAPI document from the Zod schemas via `zod-to-openapi` and serve it at `/api/v1/openapi.json` (api_design §6).

### Phase 3 — Queue, Workers & Live Progress

Long-running GA execution off the request thread, with checkpointing and SSE.

- [ ] `[P0/L]` Add Redis + BullMQ; create the `ga-pipeline` queue and a separate keyspace for GA checkpoints (api_design §7).
- [ ] `[P0/L]` Implement the worker process (`src/worker/index.ts`, `npm run worker`) that consumes `ga-pipeline`, calls `runPreGA → runSSA → runGA`, persists `ScheduleRun` / `ScheduleAssignment` / `FitnessHistory` rows, and publishes progress events on `ga-progress:<runId>` (api_design §7, techspec §7.1).
- [ ] `[P0/M]` Implement the per-run `CompetencyEligibilityMap` build step between SSA `FEASIBLE` and `runGA(...)` using `isLecturerEligibleForCourse` exclusively (techspec §6.1 step 21a, §4.3; api_design §7.1).
- [ ] `[P0/M]` Implement Redis checkpoint writes every 10 generations using the schema in techspec §7.2 (techspec §12 HIGH).
- [ ] `[P0/M]` Implement `POST /schedule-runs` with `Idempotency-Key` support, the 5-runs / 5-min rate limit, and the 422 `NO_ACTIVE_SEMESTER` / 503 `QUEUE_UNAVAILABLE` error paths (api_design §5.3.8, techspec §7.1).
- [ ] `[P0/M]` Implement `GET /schedule-runs`, `GET /schedule-runs/:id`, `DELETE /schedule-runs/:id` with the owner-vs-admin filtering rule (api_design §4.5, §5.3.8).
- [ ] `[P0/L]` Implement `GET /schedule-runs/:id/stream` (SSE) emitting `progress`, `state`, `error` events with a 15s heartbeat; terminate on COMPLETED / FAILED / CANCELLED / SSA_INFEASIBLE / PRE_GA_EMPTY / STAGNATED (api_design §5.3.8).
- [ ] `[P0/M]` Implement `POST /schedule-runs/:id/cancel` with cooperative cancellation: the worker checks the cancellation flag at the top of every generation and exits cleanly (api_design §7).
- [ ] `[P1/M]` Implement `PUT /schedule-runs/:id/assignments/:assignmentId` (manual override) — admin always, owner only when `status=COMPLETED`; mandatory `AuditLog` entry per api_design §5.3.8 and §8.
- [ ] `[P1/M]` Refactor the GA loop to release the event loop periodically (e.g., `setImmediate` between generations) so the worker can interleave cancellation checks and progress publishes without freezing (techspec §12 LOW, `[ARCH-OBS-02]`).

### Phase 4 — Frontend (FR-01, FR-02)

Out of scope for this repository per the README — the React SPA lives in a sibling frontend repo. Tracked here so the dependency on this backend is visible.

- [ ] `[P1/L]` Build the **Lock Room modal** (FR-01) consuming `POST /locked-rooms` and `GET /course-offerings` (techspec §9.1, §12 HIGH).
- [ ] `[P1/L]` Build the **SSA Failure Visualizer** / `SSAFailurePanel` (FR-02) that renders `DeadlockReport` payloads from a 422 `SSA_INFEASIBLE` response (techspec §9.2, §12 MEDIUM, ADR-04).
- [ ] `[P1/M]` Build the live fitness chart consuming `GET /schedule-runs/:id/stream`; remove the legacy `fitness=2` annotation from the previous lexicographic scheme (techspec §12 LOW, ADR-03).
- [ ] `[P2/M]` Add a per-run audit-log timeline view that surfaces the `competencyMismatch` counter alongside `hardViolations` for traceability (api_design §3.2, §8).

### Phase 5 — Thesis Empirical Validation

Drives Chapter 4 of the thesis. Depends on Phases 0–3.

- [ ] `[P1/M]` Implement the eleven black-box scenarios from techspec §10.2 as runnable integration tests (Feasible simple, SSA Phase 0 trigger, AC-3 abort, Hopcroft–Karp abort, Partial infeasibility, Parallel class, Team teaching, Fixed Room invariant, Competency mismatch (Pre-GA), Competency open assignment, Crossover comparison).
- [ ] `[P1/M]` Run the crossover comparison sweep (`singlePoint` vs `uniform` vs `pmx`) on a fixed dataset and export fitness curves to CSV for the thesis table (techspec §10.2 last row).
- [ ] `[P1/S]` Implement an admin-only audit-log export (`GET /audit-logs?format=csv`) covering `schedule_run.completed` and `schedule_run.assignment_override` (api_design §8).
- [ ] `[P2/M]` Generate the Chapter 4 charts (best-fitness curve, average-fitness curve, hard-violation curve, competency-mismatch overlay) directly from `FitnessHistory` rows.

### Decisions Needed

The following open questions from `docs/api_and_database_design.md` §9 block one or more Phase 2 / 3 items. Resolve before starting the dependent work.

- [ ] **OQ-1** Self-registration vs admin-invite for `/auth/register` (default: admin-only). Affects Phase 2 auth scope.
- [ ] **OQ-2** Whether email change is required (default: email immutable). Affects `PATCH /users/:id`.
- [ ] **OQ-3** Postgres vs SQLite/libSQL as the foregrounded target (default: Postgres + multi-process worker; SQLite single-process as defense fallback). Pins the Prisma `provider` and the deployment story for Phase 1 / Phase 3.
- [ ] **OQ-4** SSE vs WebSocket for live progress (default: SSE). Affects `GET /schedule-runs/:id/stream` and the frontend transport.
- [ ] **OQ-5** Manual override permission for `user` on completed runs (default: owner-or-admin while COMPLETED). Affects `PUT /schedule-runs/:id/assignments/:aid`.
- [ ] **OQ-6** Access / refresh token TTLs (default: 15 min / 7 days).
- [ ] **OQ-7** Soft- vs hard-delete for `User` and `ScheduleRun` (default: user soft, run hard).
- [ ] **OQ-8** Whether to deprecate `CourseOffering.isFixed` post-migration in favor of `LockedRoom` as the single source of truth (default: keep both).
- [ ] **OQ-9** Whether to promote competency tags from free-form `string[]` to a Prisma `enum` or relational `Competency` table once the taxonomy stabilizes (default: keep `string[]` for the thesis build).
