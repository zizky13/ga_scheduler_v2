## Roadmap / Backlog

**How to use this roadmap.** Tick the checkboxes as work lands; phases are roughly sequential because later phases depend on earlier ones (no API without persistence, no live progress without a queue), but individual items can move across phases if priorities shift. Each item is tagged with a priority (`P0` blocker / `P1` important / `P2` nice-to-have) and a rough size (`S` < 1 day, `M` 1–3 days, `L` ~1 week, `XL` > 1 week). Spec references point at the source of truth.

### Phase 0 — Algorithmic Core Hardening

No new infrastructure. Everything below can ship against the current `tsx`-only repo and the in-memory seed.

1. [x] `[P0/S]` Bump `STAGNATION_WINDOW` from 15 to 100 in `src/ga/runGA.ts` to match PRD v6.0 (techspec §12 MEDIUM, §4.2, ADR-05).
2. [x] `[P0/S]` Replace any biased `Array.sort(() => Math.random() - 0.5)` shuffle with a `fisherYatesShuffle` helper across `src/ga/mutation.ts`, `src/ga/crossover.ts`, and `src/ga/population.ts` (techspec §12 MEDIUM, `[ARCH-OBS-03]`).
3. [x] `[P0/S]` Add `competencyMismatch: number` to `EvaluatedChromosome` and `GAResult` in `src/types.ts`; thread it through `src/ga/fitness.ts` and `src/ga/runGA.ts` so the audit counter is exposed end-to-end (api_design §3.2, §5.3.8, §8).
4. [x] `[P0/S]` Add `hardPenaltyWeight` and `softPenaltyWeight` (defaults `100` / `1`) to `GAConfig` in `src/types.ts` and consume them in `src/ga/fitness.ts` instead of inline constants (techspec §4.3 `[ARCH-OBS-01]`, api_design §5.3.8 GAConfig truth-table note).
5. [x] `[P0/M]` Wire up a real test runner (`vitest` or `node --test`) and replace the stubbed `npm test` script in `package.json`. Carry over the existing `TODO` for tests.
6. [x] `[P0/M]` Implement `assertMaskingInvariant(parent, child)` and call it from every crossover unit test in `tests/ga/crossover.test.ts` (techspec §10, §12 LOW, FR-03).
7. [x] `[P1/M]` Add Layer 1 unit tests covering all eight `checkCompetencies` scenarios in techspec §10.1 (eligible, ineligible, empty `requiredCompetencies`, team-teaching with one ineligible co-lecturer, etc.).
8. [x] `[P1/M]` Add Layer 2 unit tests for `staticExclusion`, `ac3`, and `hopcroftKarp` matching the test outline in techspec §10.1.
9. [x] `[P1/M]` Add Layer 3 integration tests: easy-dataset convergence, stagnation exit, Fixed Room invariant across generations, elitism monotonicity (techspec §10.1).
10. [x] `[P1/S]` Verify `possibleRoomIds[]` is populated on every `PreGACandidate` for Flexible offerings; if missing, extend `src/pre-ga/validator.ts` (techspec §12 HIGH, `[ARCH-OBS-04]`).
11. [ ] `[P1/S]` Add a `LICENSE` file at the repo root matching `package.json`'s `ISC` field (or change the field). Carries over the existing README `TODO`.
12. [ ] `[P2/S]` Fill in `author`, `description`, `keywords`, and `repository` in `package.json`. Carries over the existing README `TODO`.
13. [x] `[P2/M]` Refactor `src/cli/run-pipeline.ts` and `src/cli/run-layer3.ts` to return a `SchedulerResponse` instead of printing inline, so the CLIs share the type the future API will return.

### Phase 1 — Persistence Layer

Introduce Prisma. The GA core stays Prisma-unaware; a new repository boundary adapts rows to the plain TS types in `src/types.ts` (api_design §3.5).

1. [x] `[P0/M]` Add `prisma`, `@prisma/client`, and `bcrypt` dependencies; initialize `prisma/schema.prisma` from the schema in api_design §3.2
2. [ ] `[P0/M]` Generate the initial migration covering `User`, `RefreshToken`, `Semester`, `Facility`, `Room`, `RoomFacility`, `TimeSlot`, `Lecturer`, `LecturerPreferredSlot`, `Course`, `CourseRequiredFacility`, `CourseOffering`, `CourseOfferingLecturer`, `CourseOfferingFixedSlot` (api_design §3.2).
3. [ ] `[P0/M]` Add the `LockedRoom` table migration and its indexes (techspec §5.4, §12 HIGH, FR-01; api_design §3.2).
4. [ ] `[P0/M]` Add the `ScheduleRun`, `ScheduleAssignment`, `ScheduleAssignmentSlot`, `FitnessHistory`, `AuditLog` tables — including the `competencyMismatch` audit column on both `ScheduleRun` and `FitnessHistory` (techspec §8.2, §12 MEDIUM; api_design §3.2).
5. [ ] `[P0/M]` Implement the dual-target encoding rule for `Lecturer.competencies` and `Course.requiredCompetencies`: native `String[]` on Postgres, JSON-encoded `String` on SQLite, decoded at the repository boundary (techspec `[ARCH-OBS-05]`; api_design §3.5).
6. [ ] `[P1/M]` Port `src/db/seed.ts` to a Prisma seed script that upserts a single `Semester` (`2025-GANJIL`) plus the existing rooms / slots / lecturers / courses / offerings; gate `infeasibleOfferings` behind `--with-infeasible` (api_design §3.5). Carries over the existing README `TODO` about the production data source.
7. [ ] `[P1/M]` Build a thin repository layer (`src/repo/*.ts`) that returns `Room`, `Lecturer`, `Course`, `CourseOffering`, `LockedRoom` shaped exactly like `src/types.ts` so `runPreGA`, `runSSA`, `runGA` continue to consume plain TS types.
8. [ ] `[P1/S]` Document `OQ-3` (Postgres vs SQLite) decision and pin the Prisma `provider` accordingly; update `prisma/schema.prisma` and the README config section.

### Phase 2 — API & Auth

Express transport over the existing pipeline. No GA logic changes; only routing, validation, RBAC, audit.

1. [ ] `[P0/L]` Scaffold `src/api/server.ts` with Express, JSON body parsing, `requestId` middleware, pino logging, and the centralized error envelope from api_design §6.
2. [ ] `[P0/L]` Implement Zod schemas under `src/api/schemas/*` and route handlers under `src/api/routes/*`. One schema per route; reuse `competencyArraySchema` for both lecturer and course bodies (api_design §6).
3. [ ] `[P0/L]` Implement `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` with bcrypt (cost 12), HS256 JWT (15-min access), and opaque rotated refresh tokens (7-day, hashed in `RefreshToken`) per api_design §4.
4. [ ] `[P0/M]` Implement `requireAuth`, `requireRole`, `requireOwnerOrAdmin`, `allowFields`, `rateLimitAuth`, `rateLimitRun` middleware (api_design §4.6).
5. [ ] `[P0/L]` Implement CRUD routes for `users`, `semesters`, `rooms`, `timeslots`, `facilities`, `locked-rooms` per api_design §5.3.2–§5.3.4. Honor the permission matrix in §4.5 exactly.
6. [ ] `[P0/L]` Implement CRUD for `lecturers`, `courses`, `course-offerings` including the field-level rules in api_design §4.5 and §4.6 (`isStructural` / `isFixed` / `fixedTimeSlotIds` admin-only). Surface `competencies` and `requiredCompetencies` as editable by both roles (api_design §5.3.5–§5.3.7).
7. [ ] `[P0/M]` Wire the `COMPETENCY_MISMATCH` per-offering rejection into the `preGASummary.infeasible[]` payload (not as a top-level run failure) per api_design §5.2; emit `NO_FEASIBLE_CANDIDATES` only when every offering is rejected.
8. [ ] `[P1/M]` Implement `AuditLog` writes from every state-changing endpoint with `before` / `after` diffs, request-id propagation, and redacted password hashes (api_design §8).
9. [ ] `[P1/S]` Implement `GET /health` and `GET /ready` (DB + Redis pings) per api_design §5.3.9.
10. [ ] `[P1/M]` Generate an OpenAPI document from the Zod schemas via `zod-to-openapi` and serve it at `/api/v1/openapi.json` (api_design §6).

### Phase 3 — Queue, Workers & Live Progress

Long-running GA execution off the request thread, with checkpointing and SSE.

1. [ ] `[P0/L]` Add Redis + BullMQ; create the `ga-pipeline` queue and a separate keyspace for GA checkpoints (api_design §7).
2. [ ] `[P0/L]` Implement the worker process (`src/worker/index.ts`, `npm run worker`) that consumes `ga-pipeline`, calls `runPreGA → runSSA → runGA`, persists `ScheduleRun` / `ScheduleAssignment` / `FitnessHistory` rows, and publishes progress events on `ga-progress:<runId>` (api_design §7, techspec §7.1).
3. [ ] `[P0/M]` Implement the per-run `CompetencyEligibilityMap` build step between SSA `FEASIBLE` and `runGA(...)` using `isLecturerEligibleForCourse` exclusively (techspec §6.1 step 21a, §4.3; api_design §7.1).
4. [ ] `[P0/M]` Implement Redis checkpoint writes every 10 generations using the schema in techspec §7.2 (techspec §12 HIGH).
5. [ ] `[P0/M]` Implement `POST /schedule-runs` with `Idempotency-Key` support, the 5-runs / 5-min rate limit, and the 422 `NO_ACTIVE_SEMESTER` / 503 `QUEUE_UNAVAILABLE` error paths (api_design §5.3.8, techspec §7.1).
6. [ ] `[P0/M]` Implement `GET /schedule-runs`, `GET /schedule-runs/:id`, `DELETE /schedule-runs/:id` with the owner-vs-admin filtering rule (api_design §4.5, §5.3.8).
7. [ ] `[P0/L]` Implement `GET /schedule-runs/:id/stream` (SSE) emitting `progress`, `state`, `error` events with a 15s heartbeat; terminate on COMPLETED / FAILED / CANCELLED / SSA_INFEASIBLE / PRE_GA_EMPTY / STAGNATED (api_design §5.3.8).
8. [ ] `[P0/M]` Implement `POST /schedule-runs/:id/cancel` with cooperative cancellation: the worker checks the cancellation flag at the top of every generation and exits cleanly (api_design §7).
9. [ ] `[P1/M]` Implement `PUT /schedule-runs/:id/assignments/:assignmentId` (manual override) — admin always, owner only when `status=COMPLETED`; mandatory `AuditLog` entry per api_design §5.3.8 and §8.
10. [ ] `[P1/M]` Refactor the GA loop to release the event loop periodically (e.g., `setImmediate` between generations) so the worker can interleave cancellation checks and progress publishes without freezing (techspec §12 LOW, `[ARCH-OBS-02]`).

### Phase 4 — Frontend (FR-01, FR-02)

Out of scope for this repository per the README — the React SPA lives in a sibling frontend repo. Tracked here so the dependency on this backend is visible.

1. [ ] `[P1/L]` Build the **Lock Room modal** (FR-01) consuming `POST /locked-rooms` and `GET /course-offerings` (techspec §9.1, §12 HIGH).
2. [ ] `[P1/L]` Build the **SSA Failure Visualizer** / `SSAFailurePanel` (FR-02) that renders `DeadlockReport` payloads from a 422 `SSA_INFEASIBLE` response (techspec §9.2, §12 MEDIUM, ADR-04).
3. [ ] `[P1/M]` Build the live fitness chart consuming `GET /schedule-runs/:id/stream`; remove the legacy `fitness=2` annotation from the previous lexicographic scheme (techspec §12 LOW, ADR-03).
4. [ ] `[P2/M]` Add a per-run audit-log timeline view that surfaces the `competencyMismatch` counter alongside `hardViolations` for traceability (api_design §3.2, §8).

### Phase 5 — Thesis Empirical Validation

Drives Chapter 4 of the thesis. Depends on Phases 0–3.

1. [ ] `[P1/M]` Implement the eleven black-box scenarios from techspec §10.2 as runnable integration tests (Feasible simple, SSA Phase 0 trigger, AC-3 abort, Hopcroft–Karp abort, Partial infeasibility, Parallel class, Team teaching, Fixed Room invariant, Competency mismatch (Pre-GA), Competency open assignment, Crossover comparison).
2. [ ] `[P1/M]` Run the crossover comparison sweep (`singlePoint` vs `uniform` vs `pmx`) on a fixed dataset and export fitness curves to CSV for the thesis table (techspec §10.2 last row).
3. [ ] `[P1/S]` Implement an admin-only audit-log export (`GET /audit-logs?format=csv`) covering `schedule_run.completed` and `schedule_run.assignment_override` (api_design §8).
4. [ ] `[P2/M]` Generate the Chapter 4 charts (best-fitness curve, average-fitness curve, hard-violation curve, competency-mismatch overlay) directly from `FitnessHistory` rows.

### Decisions Needed

The following open questions from `docs/api_and_database_design.md` §9 block one or more Phase 2 / 3 items. Resolve before starting the dependent work.

1. [ ] **OQ-1** Self-registration vs admin-invite for `/auth/register` (default: admin-only). Affects Phase 2 auth scope.
2. [ ] **OQ-2** Whether email change is required (default: email immutable). Affects `PATCH /users/:id`.
3. [ ] **OQ-3** Postgres vs SQLite/libSQL as the foregrounded target (default: Postgres + multi-process worker; SQLite single-process as defense fallback). Pins the Prisma `provider` and the deployment story for Phase 1 / Phase 3.
4. [ ] **OQ-4** SSE vs WebSocket for live progress (default: SSE). Affects `GET /schedule-runs/:id/stream` and the frontend transport.
5. [ ] **OQ-5** Manual override permission for `user` on completed runs (default: owner-or-admin while COMPLETED). Affects `PUT /schedule-runs/:id/assignments/:aid`.
6. [ ] **OQ-6** Access / refresh token TTLs (default: 15 min / 7 days).
7. [ ] **OQ-7** Soft- vs hard-delete for `User` and `ScheduleRun` (default: user soft, run hard).
8. [ ] **OQ-8** Whether to deprecate `CourseOffering.isFixed` post-migration in favor of `LockedRoom` as the single source of truth (default: keep both).
9. [ ] **OQ-9** Whether to promote competency tags from free-form `string[]` to a Prisma `enum` or relational `Competency` table once the taxonomy stabilizes (default: keep `string[]` for the thesis build).
