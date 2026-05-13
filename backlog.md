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
14. [x] `[P1/S]` **SKS Blocks:** Add `parallelSessionCount` (capacity logic) and `sessionDuration` (sks mapping) to `PreGACandidate` in `src/types.ts`.
15. [x] `[P1/S]` **SKS Blocks:** Update `src/pre-ga/validator.ts` to populate the new `parallelSessionCount` and `sessionDuration` properties for all candidates, removing the old `requiredSessions`.
16. [x] `[P1/S]` **SKS Blocks:** Refactor `Gene` and `Chromosome` interfaces in `src/types.ts` to replace flat `assignedTimeSlotIds` with an array: `sessions: { roomId: number, timeSlotIds: number[] }[]`.
17. [x] `[P1/M]` **SKS Blocks:** Write a `findContiguousSlots(availableSlots, duration)` utility in `src/ga/chromosome.ts` that strictly finds back-to-back slots happening on the same day.
18. [x] `[P1/M]` **SKS Blocks:** Update `generateInitialPopulation` and `mutation.ts` to use `findContiguousSlots` so all genes generated and mutated are valid contiguous blocks.
19. [x] `[P1/S]` **SKS Blocks:** Update `src/ga/crossover.ts` to safely swap the new `sessions` arrays between parent chromosomes.
20. [x] `[P1/M]` **SKS Blocks:** Update `evaluateHardFitness` in `src/ga/fitness.ts` to loop over the new nested `sessions` array and accurately count room/lecturer collisions.
21. [x] `[P1/M]` **SKS Blocks:** Update soft constraint functions (`calculateStructuralPenalty`, `calculatePreferencePenalty`) in `src/ga/fitness.ts` to map over the new `sessions` array.
22. [x] `[P1/M]` **SKS Blocks:** Refactor `src/ssa/bipartiteGraph.ts` to map whole multi-slot blocks as single matching nodes, ensuring Hopcroft-Karp proves feasibility for contiguous chunks, not isolated slots.
23. [x] `[P1/M]` **SKS Blocks:** Update `src/ga/repair.ts` to implement full contiguous-block repair logic. It should resolve hard conflicts by replacing the entire session with a new contiguous block instead of doing a greedy per-slot reassignment.
24. [x] `[P1/S]` **SKS Blocks:** Update `src/db/seed.ts` so that `fixedTimeSlotIds` for fixed offerings provides exactly `sks` number of contiguous slots instead of a single slot, ensuring domain lengths match requested session durations.

### Phase 1 — Persistence Layer

Introduce Prisma. The GA core stays Prisma-unaware; a new repository boundary adapts rows to the plain TS types in `src/types.ts` (api_design §3.5).

1. [x] `[P0/M]` Add `prisma`, `@prisma/client`, and `bcrypt` dependencies; initialize `prisma/schema.prisma` from the schema in api_design §3.2
2. [x] `[P0/M]` Generate the initial migration covering `User`, `RefreshToken`, `Semester`, `Facility`, `Room`, `RoomFacility`, `TimeSlot`, `Lecturer`, `LecturerPreferredSlot`, `Course`, `CourseRequiredFacility`, `CourseOffering`, `CourseOfferingLecturer`, `CourseOfferingFixedSlot` (api_design §3.2).
3. [x] `[P0/M]` Add the `LockedRoom` table migration and its indexes (techspec §5.4, §12 HIGH, FR-01; api_design §3.2).
4. [x] `[P0/M]` Add the `ScheduleRun`, `ScheduleAssignment`, `ScheduleAssignmentSlot`, `FitnessHistory`, `AuditLog` tables — including the `competencyMismatch` audit column on both `ScheduleRun` and `FitnessHistory` (techspec §8.2, §12 MEDIUM; api_design §3.2).
5. [x] `[P0/M]` Implement the dual-target encoding rule for `Lecturer.competencies` and `Course.requiredCompetencies`: native `String[]` on Postgres, JSON-encoded `String` on SQLite, decoded at the repository boundary (techspec `[ARCH-OBS-05]`; api_design §3.5).
6. [x] `[P1/M]` Port `src/db/seed.ts` to a Prisma seed script that upserts a single `Semester` (`2025-GANJIL`) plus the existing rooms / slots / lecturers / courses / offerings; gate `infeasibleOfferings` behind `--with-infeasible` (api_design §3.5). Carries over the existing README `TODO` about the production data source.
7. [x] `[P1/M]` Build a thin repository layer (`src/repo/*.ts`) that returns `Room`, `Lecturer`, `Course`, `CourseOffering`, `LockedRoom` shaped exactly like `src/types.ts` so `runPreGA`, `runSSA`, `runGA` continue to consume plain TS types.
8. [x] `[P1/S]` Document `OQ-3` (Postgres vs SQLite) decision and pin the Prisma `provider` accordingly; update `prisma/schema.prisma` and the README config section.
9. [x] `[P1/S]` **SKS Blocks (Persistence):** Add `sessionIndex Int` column to `ScheduleAssignment` in `prisma/schema.prisma` so each parallel session (Session A, Session B) is stored as its own row rather than as a single offering row.
10. [x] `[P1/S]` **SKS Blocks (Persistence):** Change the `@@unique` constraint on `ScheduleAssignment` from `[runId, offeringId]` to `[runId, offeringId, sessionIndex]` and create a new Prisma migration for these two schema changes.
11. [x] `[P1/S]` **SKS Blocks (Persistence):** Update the `ScheduleAssignment` repository mapper in `src/repo/*.ts` to read and write the new `sessionIndex` field so the GA result can be correctly persisted and retrieved.

### Phase 2 — API & Auth

Express transport over the existing pipeline. No GA logic changes; only routing, validation, RBAC, audit.

1. [x] `[P0/L]` Scaffold `src/api/server.ts` with Express, JSON body parsing, `requestId` middleware, pino logging, and the centralized error envelope from api_design §6.
2. [x] `[P0/L]` Implement Zod schemas under `src/api/schemas/*` and route handlers under `src/api/routes/*`. One schema per route; reuse `competencyArraySchema` for both lecturer and course bodies (api_design §6).
3. [x] `[P0/L]` Implement `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` with bcrypt (cost 12), HS256 JWT (15-min access), and opaque rotated refresh tokens (7-day, hashed in `RefreshToken`) per api_design §4.
4. [x] `[P0/M]` Implement `requireAuth`, `requireRole`, `requireOwnerOrAdmin`, `allowFields`, `rateLimitAuth`, `rateLimitRun` middleware (api_design §4.6).
5. [x] `[P0/L]` Implement CRUD routes for `users`, `semesters`, `rooms`, `timeslots`, `facilities`, `locked-rooms` per api_design §5.3.2–§5.3.4. Honor the permission matrix in §4.5 exactly.
6. [x] `[P0/L]` Implement CRUD for `lecturers`, `courses`, `course-offerings` including the field-level rules in api_design §4.5 and §4.6 (`isStructural` / `isFixed` / `fixedTimeSlotIds` admin-only). Surface `competencies` and `requiredCompetencies` as editable by both roles (api_design §5.3.5–§5.3.7).
7. [x] `[P0/M]` Wire the `COMPETENCY_MISMATCH` per-offering rejection into the `preGASummary.infeasible[]` payload (not as a top-level run failure) per api_design §5.2; emit `NO_FEASIBLE_CANDIDATES` only when every offering is rejected.
8. [x] `[P1/M]` Implement `AuditLog` writes from every state-changing endpoint with `before` / `after` diffs, request-id propagation, and redacted password hashes (api_design §8).
9. [x] `[P1/S]` Implement `GET /health` and `GET /ready` (DB + Redis pings) per api_design §5.3.9.
10. [x] `[P1/M]` Generate an OpenAPI document from the Zod schemas via `zod-to-openapi` and serve it at `/api/v1/openapi.json` (api_design §6).

### Phase 3 — Queue, Workers & Live Progress

Long-running GA execution off the request thread, with checkpointing and SSE.

1. [x] `[P0/L]` Add Redis + BullMQ; create the `ga-pipeline` queue and a separate keyspace for GA checkpoints (api_design §7).
2. [x] `[P0/L]` Implement the worker process (`src/worker/index.ts`, `npm run worker`) that consumes `ga-pipeline`, calls `runPreGA → runSSA → runGA`, persists `ScheduleRun` / `ScheduleAssignment` / `FitnessHistory` rows, and publishes progress events on `ga-progress:<runId>` (api_design §7, techspec §7.1).
3. [x] `[P0/M]` Implement the per-run `CompetencyEligibilityMap` build step between SSA `FEASIBLE` and `runGA(...)` using `isLecturerEligibleForCourse` exclusively (techspec §6.1 step 21a, §4.3; api_design §7.1).
4. [x] `[P0/M]` Implement Redis checkpoint writes every 10 generations using the schema in techspec §7.2 (techspec §12 HIGH).
5. [x] `[P0/M]` Implement `POST /schedule-runs` with `Idempotency-Key` support, the 5-runs / 5-min rate limit, and the 422 `NO_ACTIVE_SEMESTER` / 503 `QUEUE_UNAVAILABLE` error paths (api_design §5.3.8, techspec §7.1).
6. [x] `[P0/M]` Implement `GET /schedule-runs`, `GET /schedule-runs/:id`, `DELETE /schedule-runs/:id` with the owner-vs-admin filtering rule (api_design §4.5, §5.3.8).
7. [x] `[P0/L]` Implement `GET /schedule-runs/:id/stream` (SSE) emitting `progress`, `state`, `error` events with a 15s heartbeat; terminate on COMPLETED / FAILED / CANCELLED / SSA_INFEASIBLE / PRE_GA_EMPTY / STAGNATED (api_design §5.3.8).
8. [x] `[P0/M]` Implement `POST /schedule-runs/:id/cancel` with cooperative cancellation: the worker checks the cancellation flag at the top of every generation and exits cleanly (api_design §7).
9. [x] `[P1/M]` Implement `PUT /schedule-runs/:id/assignments/:assignmentId` (manual override) — admin always, owner only when `status=COMPLETED`; mandatory `AuditLog` entry per api_design §5.3.8 and §8.
10. [x] `[P1/M]` Refactor the GA loop to release the event loop periodically (e.g., `setImmediate` between generations) so the worker can interleave cancellation checks and progress publishes without freezing (techspec §12 LOW, `[ARCH-OBS-02]`).
11. [x] `[P1/M]` **SKS Blocks (Worker):** Update the worker's `ScheduleAssignment` persistence loop to iterate over the new `sessions[]` array on each gene, inserting one `ScheduleAssignment` row per parallel session (with correct `sessionIndex` and `roomId`) instead of one row per offering.
12. [x] `[P1/S]` **SKS Blocks (Worker):** Update the worker's `ScheduleAssignmentSlot` persistence loop to write the contiguous `timeSlotIds` block for each `sessionIndex` row, matching the new nested gene structure.
13. [x] `[P1/S]` **SKS Blocks (API):** Update `GET /schedule-runs/:id` response serializer to group `ScheduleAssignment` rows by `offeringId` and expose sessions as a nested array (e.g., `sessions: [{ sessionIndex, roomId, timeSlots }]`) so the frontend can render each parallel session correctly.

### Phase 4 — Frontend

The full SPA implementing the design specification in `docs/app-design-spec.md`. Depends on Phases 0–3 (all backend APIs, persistence, queue, and SSE must be operational). Sub-phases are roughly sequential; items within a sub-phase are ordered by dependency.

#### Phase 4a — Project Setup & Design Foundations

1. [x] `[P0/M]` Initialize the frontend project (framework, build tool, dev server, TypeScript config, linting, formatting). Install core dependencies: router, HTTP client, state management, Lucide icons, charting library (Recharts or Chart.js) (design-spec §1, §8).
2. [x] `[P0/S]` Set up API client module with base URL configuration, JSON parsing, and centralized error-envelope unwrapping matching the backend's `{ status, data, error }` shape (api_design §6).
3. [x] `[P0/M]` Implement the **CSS custom properties** file defining all design tokens: colors (primary, secondary, accent, semantic), typography scale, spacing scale, border-radius, shadows, transition durations, easing functions, and layout variables (design-spec §16).
4. [x] `[P0/S]` Configure **font loading** for Inter (400/500/600/700, `font-display: swap`) and JetBrains Mono (400/500, `font-display: optional`) via Google Fonts (design-spec §3.1).
5. [x] `[P0/S]` Implement **dark mode** token overrides under `[data-theme="dark"]` covering all color, shadow, and surface tokens (design-spec §2.2, §16).
6. [x] `[P1/S]` Add the **schedule block color palette** tokens for seven course categories plus Fixed/Locked, both light and dark variants (design-spec §2.3).
7. [x] `[P1/S]` Implement **dark mode toggle logic**: persist user preference to `localStorage`, respect `prefers-color-scheme` on first visit, apply `data-theme` attribute to document root (design-spec §10.2).
8. [x] `[P1/S]` Implement **responsive breakpoint** utility/CSS (mobile < 640px, tablet 640–1024px, desktop > 1024px) and responsive typography using `clamp()` (design-spec §9, §3.3).
9. [x] `[P0/S]` Create global CSS reset / base styles: box-sizing, default font family, body background, text color, `@media (prefers-reduced-motion)` wrapper for all transitions (design-spec §7, §15).

#### Phase 4b — Application Shell & Layout

10. [ ] `[P0/L]` Build the **Sidebar Navigation** component: fixed-left, 256px expanded / 64px collapsed, grouped nav items (Data Management, Scheduling, Administration), active-state highlighting, collapse toggle with animated width transition, group labels in overline style (design-spec §10.1).
11. [ ] `[P0/M]` Build the **Sidebar Footer** showing user avatar (initials), name, role badge, and logout button; collapsed mode shows avatar only with popover (design-spec §10.1).
12. [ ] `[P0/M]` Build the **Top Bar / Header** component: breadcrumbs on left, semester selector dropdown + dark mode toggle + user menu dropdown on right; fixed top, offset by sidebar width (design-spec §10.2).
13. [ ] `[P0/M]` Build the **Content Area** layout: offset by sidebar and top bar, padded per breakpoint, max-width 1440px centered, page header pattern (title + optional description + right-aligned action buttons) (design-spec §10.3).
14. [ ] `[P1/M]` Implement **Semester Selector** dropdown in the top bar with confirmation dialog on switch, unsaved-form guard that disables the selector, and post-switch toast notification (design-spec §10.2).
15. [ ] `[P0/M]` Implement **responsive shell behavior**: sidebar hidden with hamburger drawer on mobile, icon-only collapsed on tablet, fully expanded on desktop; content area width adjusts accordingly (design-spec §9).
16. [ ] `[P0/M]` Implement **client-side routing** with protected route guards: unauthenticated users redirect to `/login`, role-based guards for ADMIN-only routes (`/users`, `/audit-log`, `/semesters`, `/facilities`), breadcrumb generation from route hierarchy (design-spec §10.1, §10.2).

#### Phase 4c — Shared Component Library

17. [ ] `[P0/L]` Build the **Data Table** component: container with border-radius and shadow, table header row (sortable columns with arrow icons), body rows (hover, selected, alternating-row states), row action column (three-dot menu or inline edit/delete icons), pagination bar (rows-per-page select, page numbers, showing X-Y of Z) (design-spec §11.1).
18. [ ] `[P0/M]` Build the **Table Toolbar**: search input (280px, search icon prefix), filter buttons with active-count badge, pagination info, view-toggle icons (design-spec §11.1).
19. [ ] `[P0/S]` Build table **loading state** (5 skeleton rows) and **empty state** (centered icon + title + description + action button, 320px min-height) for the Data Table (design-spec §11.1).
20. [ ] `[P1/M]` Build table **mobile card-list** mode: each row renders as a card with title, key-value pairs, and three-dot action menu; triggered automatically below 640px (design-spec §11.1).
21. [ ] `[P1/M]` Build **Bulk Operations** support on the Data Table: header checkbox for select-all-on-page, per-row checkboxes, selection-indicator strip replacing toolbar ("[N] selected" + "Select all [total]" link + Bulk Delete danger button + Bulk Export CSV button + deselect X), confirmation dialog for bulk delete with partial-delete handling (design-spec §11.1).
22. [ ] `[P0/M]` Build the **Form Components**: text input (with label, helper text, error message, required asterisk), select (with dropdown), number input (with stepper buttons), checkbox, radio button, toggle/switch (design-spec §11.2).
23. [ ] `[P0/S]` Build the **Multi-Select / Tag Input** component: auto-expanding container, pill-shaped removable tags, dropdown with checkboxes and search-within; used for competencies and facilities (design-spec §11.2).
24. [ ] `[P1/S]` Build the **Date Picker** (calendar grid dropdown, month navigation) and **Time Input** (HH:MM format with clock icon, 120px width) form components (design-spec §11.2).
25. [ ] `[P0/M]` Build the **Modal / Dialog** component: sm/md/lg/xl widths, backdrop, header with title and close button, scrollable body, footer with action buttons, entrance animation (slide-up + fade), full-screen on mobile (design-spec §11.3).
26. [ ] `[P0/S]` Build the **Confirmation Dialog** variant: icon circle (danger/warning), centered title and description, stacked full-width buttons on mobile (design-spec §11.3).
27. [ ] `[P0/M]` Build the **Button** component: sizes (sm/md/lg), variants (primary filled, secondary outlined, ghost, danger filled, icon-only square), disabled state, dark mode overrides (design-spec §11.4).
28. [ ] `[P0/S]` Build the **Badge / Tag** components: status badges for schedule run states (QUEUED, RUNNING with animated dot, COMPLETED, STAGNATED, SSA_INFEASIBLE, PRE_GA_EMPTY, CANCELLED, FAILED), role badges (ADMIN/USER), competency/facility tags (removable variant), boolean active/inactive tags (design-spec §11.5).
29. [ ] `[P0/M]` Build the **Toast / Notification** system: fixed top-right stacking (max 3), success/error/warning/info variants with left accent border, auto-dismiss with progress bar (5s success, 8s warning, manual error), slide-in animation with `ease-spring` (design-spec §11.6).
30. [ ] `[P0/S]` Build the **Stat Card** component (icon container, label, value, optional trend) and **Info Card** component (design-spec §11.7).
31. [ ] `[P0/M]` Build the **Charts** wrapper: line chart for fitness curve (best fitness solid, average dashed, optional hard-violations area), bar chart for dashboard; responsive height, dark mode grid/axis colors, tooltip (design-spec §11.8).
32. [ ] `[P1/S]` Build the **Breadcrumbs** component: separator chevron icons, current segment bold, previous segments clickable, max 4 items with middle collapse (design-spec §11.9).
33. [ ] `[P1/S]` Build the **Skeleton Loader** primitives: text line, stat-card value, table cell, avatar circle, badge; pulse animation 0.4–1.0 opacity over 1.5s (design-spec §11.10).
34. [ ] `[P1/S]` Build the **Empty State** component: centered layout, 48px entity-specific icon, title, description (max-width 360px), action button (design-spec §11.11).
35. [ ] `[P1/S]` Build the **Search / Filter Bar** component: flex row with search input + filter button (badge count), filter dropdown panel with form fields + Apply/Reset buttons, active filter pills row (design-spec §11.12).
36. [ ] `[P1/M]` Build the **Delete Cascade Warning** dialog: extends confirmation dialog with impact section (warning-50 bg, bulleted list of dependent entity counts), blocked-delete variant (info banner replacing delete button) (design-spec §11.15).
37. [ ] `[P1/M]` Build the **Global Run-In-Progress Indicator**: subtle info banner below top bar when any run is RUNNING, "View" link to the active run, disabled-action tooltips on locked room CRUD / semester activation / offering delete; polls `GET /schedule-runs?status=RUNNING` every 30s (design-spec §11.16).

#### Phase 4d — Auth & Session Management Pages

38. [ ] `[P0/L]` Build the **Login Page**: standalone centered card on secondary background (400px, no sidebar/top bar), email + password fields, submit button with spinner loading state, error alert with shake animation, redirect to `/dashboard` on success, dark mode support (design-spec §12.1).
39. [ ] `[P0/M]` Implement **JWT auth flow**: store access token in memory, call `POST /auth/login`, attach `Authorization: Bearer` header to all API requests, call `POST /auth/logout` on sign-out clearing local state (api_design §4).
40. [ ] `[P0/M]` Implement **Silent Token Refresh**: HTTP interceptor catches 401 `ACCESS_TOKEN_EXPIRED`, automatically calls `POST /auth/refresh`, retries the original request; proactive refresh when token has < 60s remaining (design-spec §11.13).
41. [ ] `[P0/S]` Implement **Session Expired Modal**: shown on 401 `REFRESH_TOKEN_INVALID`, non-dismissable modal with Lock icon, "Sign In" button redirecting to `/login`, pauses all background API calls (design-spec §11.13).
42. [ ] `[P1/S]` Implement **Account Disabled Modal**: shown on 403 `ACCOUNT_DISABLED`, non-dismissable modal with error icon, "Sign Out" button clearing tokens and redirecting to `/login` (design-spec §11.13).
43. [ ] `[P1/M]` Implement **Rate Limit Feedback**: intercept 429 responses, show error toast with countdown from `Retry-After` header, disable triggering button with "Retry in [N]s" label until countdown expires (design-spec §11.14).
44. [ ] `[P1/M]` Build the **Self-Service Change Password** modal (accessible from top-bar user menu): current password, new password with strength indicator (4-segment bar), confirm password with mismatch validation, server-side current-password validation error (design-spec §12.13).

#### Phase 4e — Data Management Pages (CRUD)

45. [ ] `[P0/L]` Build the **Dashboard** page: page header with active semester label, 4 stat cards (Rooms, Lecturers, Courses, Offerings) in responsive grid, Recent Runs compact table (last 5 with status badges), Quick Actions card (5 navigation buttons), Recent Activity list (last 10 audit entries), skeleton loading states (design-spec §12.2).
46. [ ] `[P0/M]` Build the **Semester Management** page (ADMIN): table with Code/Label/Start Date/End Date/Status columns, active-semester row highlighting (green left border), create/edit modal (modal-md, code + label + date pickers), activate confirmation dialog, empty state (design-spec §12.3).
47. [ ] `[P0/M]` Build the **Facility Management** page (ADMIN): table with Code/Label/Rooms Using/Courses Requiring columns, drill-down popovers on counts (clickable list with links to filtered entity pages), create/edit modal (modal-sm, code + label), delete cascade warning (design-spec §12.4).
48. [ ] `[P0/L]` Build the **Room Management** page: table with Name/Capacity/Facilities (tag list)/Offerings columns, toolbar with search-by-name + filter-by-facility + filter-by-capacity-range, create/edit modal (modal-md, name + capacity + multi-select facilities), bulk operations (delete, CSV export), ADMIN-only create/edit/delete (design-spec §12.5).
49. [ ] `[P0/L]` Build the **Timeslot Management** page (ADMIN): primary visual grid view (CSS Grid, day columns, time-axis rows, positioned timeslot blocks with hover edit), fallback table view with day/start/end/duration columns, view-switcher toggle, create/edit modal (modal-sm, day + start time + end time), overlap validation (design-spec §12.6).
50. [ ] `[P0/L]` Build the **Lecturer Management** page: table with Name/Structural (boolean tag)/Competencies (tags)/Preferred Slots (count)/Offerings columns, toolbar with search-by-name + filter-by-competency + filter-by-structural, create/edit modal (modal-md, name + structural toggle + competency tag input + preferred slots mini-grid), bulk operations, delete cascade warning with blocked-delete variant (409 from API) (design-spec §12.7).
51. [ ] `[P0/L]` Build the **Course Management** page: table with Code (mono)/Name/SKS (badge)/Required Competencies (tags)/Required Facilities (tags)/Offerings columns, toolbar with search-by-code-or-name + filter-by-SKS + filter-by-facility, create/edit modal (modal-md, code + name + SKS + competency tag input + facility multi-select), bulk operations, delete cascade warning (design-spec §12.8).
52. [ ] `[P0/XL]` Build the **Course Offering Management** page: table with Course (code + name)/Room/Lecturers (truncated)/Students/Fixed (boolean)/Parent/Locked Room columns, toolbar with search + filters (isFixed, hasParent, room, lecturer), create/edit modal (modal-lg) with four sections — Course & Room (searchable selects, student count, parent offering select), Lecturers (multi-select with competency sub-text and match icon), Fixed Schedule (collapsible toggle + timeslot checkboxes grouped by day), Room Lock (toggle + reason input + compatibility filter), competency match indicator (real-time client-side check showing match/partial-mismatch), parallel split info banner, bulk operations, empty state (design-spec §12.9).
53. [ ] `[P1/M]` Build the **Locked Room Summary View**: slide-over panel (480px, right side) accessible from offerings toolbar "Locked Rooms ([count])" button, list of lock cards (course + room + locked-by + reason), unlock/edit actions, GA-run-active freeze with info banner, empty state (design-spec §12.9).

#### Phase 4f — Schedule Execution & Monitoring

54. [ ] `[P0/L]` Build the **Schedule Run History** list page (`/runs`): table with Status (badge)/Created/Generation (mono)/Best Fitness (colored)/Hard Violations/Soft Penalty/Duration columns, toolbar with status filter + search + sort-by-date, row actions (View, View Schedule if COMPLETED, Cancel if RUNNING), empty state (design-spec §12.10.1).
55. [ ] `[P0/L]` Build the **Run Creation Form** page (`/runs/new`): centered card (max-width 640px), GA Configuration section (population size, max generations, crossover rate, mutation rate, crossover strategy select, elitism count) with range validation and help text, Pre-flight Info section (read-only summary of active semester data counts), Start Run confirmation dialog, rate-limit handling on submit button (design-spec §12.10.2).
56. [ ] `[P0/XL]` Build the **GA Progress Monitor** component (`/runs/:id`): header bar (run ID copyable, status badge with RUNNING pulse animation, live elapsed timer), 5-card stats panel (Generation, Best Fitness color-coded, Hard Violations, Soft Penalty, Competency Mismatch), progress bar (determinate fill with gradient, indeterminate shimmer while QUEUED, percentage label), fitness curve chart (real-time SSE-driven, best/avg/violations lines, progressive draw animation, tooltip), action bar (Cancel Run danger button with confirmation dialog, View Schedule primary button on completion) (design-spec §14, §12.10.3).
57. [ ] `[P0/L]` Implement **SSE client** for `GET /schedule-runs/:id/stream`: connect on mount, parse `progress`/`state`/`error` events, feed data into stats panel and chart, handle 15s heartbeat, reconnect on disconnect with exponential backoff (1s/2s/4s/8s/max 30s), show "Connection lost. Reconnecting..." banner, backfill missed data via REST on reconnect (design-spec §14.9).
58. [ ] `[P0/M]` Implement **run completion transitions**: COMPLETED (success confetti dots, "View Schedule" becomes primary), STAGNATED (warning banner with stagnation generation), FAILED (error card with errorCode/errorMessage), CANCELLED (info banner), status badge and progress bar finalization (design-spec §14.8, §12.10.3).
59. [ ] `[P0/L]` Build the **SSA Failure Panel**: replaces progress view on `SSA_INFEASIBLE`, header card (error bg, AlertTriangle, title, description), 3-stat triad (Sessions Required, Max Schedulable, Unresolvable Gap), Deadlock Report card (message text, affected offering pills, recommendation box), action bar ("Edit Offerings" primary, "Back to Runs" secondary) (design-spec §12.10.3).
60. [ ] `[P0/L]` Build the **Pre-GA Failure Panel**: replaces progress view on `PRE_GA_EMPTY`, header card (error bg, AlertCircle, title, description), 2-stat summary (Passed Validation, Rejected), rejection breakdown table (Offering, Reason badge color-coded, Details, row-click to edit offering), action bar ("Fix Offerings" primary, "Fix Lecturers" secondary, "Back to Runs") (design-spec §12.10.3).

#### Phase 4g — Schedule Viewer & Export

61. [ ] `[P0/XL]` Build the **Schedule Timetable Grid** special component: CSS Grid container (time-label column 80px + day columns `minmax(160px, 1fr)`), sticky day header row (uppercase, secondary-50 bg), sticky time label column (mono font, right-aligned), 1px gap grid lines via parent bg color, responsive row height (60px comfortable / 44px compact) (design-spec §13.1–§13.3, §13.4).
62. [ ] `[P0/L]` Build the **Course Blocks** within the timetable grid: positioned via `grid-row` spanning for multi-slot sessions, category-colored backgrounds with 3px left border, content (course code mono, course name, lecturer, room, session label for parallel splits), block states (default, hover with shadow, fixed/dashed border + Lock icon, manual-override with Pencil icon, conflict with red pulse, selected with primary border, filtered-out at 20% opacity), tooltip on 500ms hover delay (full details) (design-spec §13.5).
63. [ ] `[P0/L]` Build the **Schedule Viewer** page (`/schedule`): page header with run selector dropdown (completed runs, format: date + fitness + status), toolbar (room multi-select filter, lecturer search filter, day filter, course filter, density toggle, export button, print button), timetable grid, run summary panel below grid (best fitness, hard violations, soft penalty, total assignments, duration, generations), empty state when no completed runs, skeleton loading (design-spec §12.11).
64. [ ] `[P1/M]` Implement **schedule grid filter behavior**: non-matching blocks fade to 20% opacity, matching blocks remain full, grid structure always visible; all filters composable (design-spec §13.6).
65. [ ] `[P1/M]` Implement **CSV export**: "Export as CSV" option in export dropdown, generates flat CSV (Day, Time Start, Time End, Course Code, Course Name, Room, Lecturer(s), Session) respecting active filters, immediate download (design-spec §12.11).
66. [ ] `[P1/M]` Implement **PDF export**: "Export as PDF" option, loading state on button ("Generating..." with spinner), landscape PDF with timetable rendered as table + semester header + run metadata footer, success/error toast, auto-download (design-spec §12.11).
67. [ ] `[P1/M]` Implement **print stylesheet**: `@media print` hides sidebar/top bar/toolbar/tooltips, grid full-width, white bg, black text, category colors at 50% saturation, 10px block font, header with "GA Scheduler -- [Semester] -- Generated [Date]", footer with page numbers and run stats, landscape orientation via `@page` (design-spec §13.8, §12.11).
68. [ ] `[P1/M]` Implement **mobile schedule view**: horizontal-scroll grid with sticky time column and day headers below 1024px; card-based list fallback below 640px (each assignment as a card grouped by day, sortable by time), grid/list toggle in toolbar (design-spec §13.10, §12.11).
69. [ ] `[P0/L]` Build the **Manual Override** modal (modal-lg): accessed by clicking a course block in the grid (ADMIN only), header with course code and session, current assignment display card, override form (searchable room select, timeslot multi-select grouped by day matching session duration, required reason textarea min 10 chars), real-time conflict detection (room conflict warning, lecturer conflict warning, no-conflict success), force-override capability, post-save grid update with "Manual Override" badge on block + toast + audit log entry (design-spec §12.12).

#### Phase 4h — Administration Pages

70. [ ] `[P0/L]` Build the **User Management** page (ADMIN): table with Name/Email/Role (badge)/Status (active/inactive tag)/Last Login/Created columns, toolbar with search-by-name-or-email + filter-by-role + filter-by-status, create modal (modal-md, name + email + password + role select + active toggle), edit modal (same fields minus password, with "Reset Password" ghost button expanding to new-password + confirm-password fields), deactivate confirmation dialog (design-spec §12.13).
71. [ ] `[P0/L]` Build the **Audit Log Viewer** page (ADMIN): table with Timestamp (mono)/Actor/Action (color-coded badge: create=blue, update=yellow, delete=red)/Entity (type + ID)/Details (expandable)/IP Address columns, toolbar with date-range picker + search + filter-by-actor + filter-by-entity-type + filter-by-action-type, expandable row detail (full-width section with pretty-printed JSON diff + user agent), mandatory pagination (default 50/page), empty state (design-spec §12.14).

#### Phase 4i — Polish, Accessibility & Responsive

72. [ ] `[P0/M]` Implement **WCAG AA keyboard navigation**: all interactive elements focusable via Tab, focus order follows visual order, sidebar navigable with arrow keys, modal focus trapping with return-focus on close, `:focus-visible` ring using `--shadow-ring` (design-spec §15).
73. [ ] `[P0/M]` Add **semantic HTML and ARIA attributes**: `<nav aria-label>` for sidebar with `aria-current="page"`, `aria-expanded` on collapse toggle, `<table>` with `<caption>` and `aria-sort` on sortable headers, `role="dialog"` + `aria-modal` + `aria-labelledby` on modals, `role="alert"` + `aria-live` on toasts, `role="progressbar"` + `aria-valuenow/min/max` on progress bar, `role="grid"` + `aria-label` on schedule grid with `role="gridcell"` + descriptive `aria-label` on course blocks, text summary below fitness chart for screen readers (design-spec §15).
74. [ ] `[P1/S]` Implement **reduced motion** support: wrap all transform/opacity animations in `@media (prefers-reduced-motion: no-preference)`, fallback to `--duration-fast` with no transforms under `reduce`; chart data still updates but without draw animation (design-spec §7, §15).
75. [ ] `[P1/S]` Ensure **color is not the sole indicator** across the app: status badges include text labels, chart lines differ by dash pattern, schedule blocks always have text content (design-spec §15).
76. [ ] `[P1/S]` Ensure **text scaling** support: layout remains functional at 200% browser zoom, sidebar collapses, tables scroll, no horizontal overflow on main content (design-spec §15).
77. [ ] `[P1/S]` Ensure **touch targets** are minimum 44px x 44px on all interactive elements on touch devices, including table row actions and sidebar items (design-spec §15).
78. [ ] `[P1/M]` Implement **dark mode** for all page-level views: verify every page renders correctly with dark tokens, schedule grid uses dark category colors, charts use dark grid/axis colors, modals and toasts follow dark surface tokens (design-spec §2.2, §13.9, §11.6, §11.3).
79. [ ] `[P1/M]` Implement all **animation and transition** specs: sidebar collapse (`--duration-slow`, `--ease-in-out`), modal entrance (backdrop fade + dialog slide-up), table row hover (`--duration-fast`), toast slide-in (`--ease-spring`) with auto-dismiss slide-out, chart fitness-curve progressive draw (`stroke-dasharray`/`stroke-dashoffset`) (design-spec §7).
80. [ ] `[P2/M]` Add **density toggle** to the Schedule Timetable Grid: comfortable mode (60px rows, 8px padding) vs. compact mode (44px rows, 4px padding, caption-size fonts throughout) (design-spec §13.7).
81. [ ] `[P2/M]` Add optional **celebration animation** on run completion: subtle confetti-like dot burst (1 second, muted colors) when status transitions to COMPLETED (design-spec §12.10.3).
82. [ ] `[P2/S]` Add **login card shake animation** on wrong credentials (subtle horizontal shake, reduced-motion aware) (design-spec §12.1).

### Phase 5 — Thesis Empirical Validation

Drives Chapter 4 of the thesis. Depends on Phases 0–3.

1. [ ] `[P1/M]` Implement the eleven black-box scenarios from techspec §10.2 as runnable integration tests (Feasible simple, SSA Phase 0 trigger, AC-3 abort, Hopcroft–Karp abort, Partial infeasibility, Parallel class, Team teaching, Fixed Room invariant, Competency mismatch (Pre-GA), Competency open assignment, Crossover comparison).
2. [ ] `[P1/M]` Run the crossover comparison sweep (`singlePoint` vs `uniform` vs `pmx`) on a fixed dataset and export fitness curves to CSV for the thesis table (techspec §10.2 last row).
3. [ ] `[P1/S]` Implement an admin-only audit-log export (`GET /audit-logs?format=csv`) covering `schedule_run.completed` and `schedule_run.assignment_override` (api_design §8).
4. [ ] `[P2/M]` Generate the Chapter 4 charts (best-fitness curve, average-fitness curve, hard-violation curve, competency-mismatch overlay) directly from `FitnessHistory` rows.

### Decisions Needed

The following open questions from `docs/api_and_database_design.md` §9 block one or more Phase 2 / 3 items. Resolve before starting the dependent work.

1. [x] **OQ-1** Self-registration vs admin-invite for `/auth/register` (default: admin-only). Affects Phase 2 auth scope. **Resolved: admin-only by default, email immutable**. See `src/lib/auth.ts:signup`.
2. [x] **OQ-2** Whether email change is required (default: email immutable). Affects `PATCH /users/:id`. **Resolved: email change disallowed; users must contact admin**. See `src/lib/auth.ts:updateEmail`.
3. [x] **OQ-3** Postgres vs SQLite/libSQL as the foregrounded target (default: Postgres + multi-process worker; SQLite single-process as defense fallback). Pins the Prisma `provider` and the deployment story for Phase 1 / Phase 3. — **Resolved: Postgres pinned**; SQLite remains a thesis-defense fallback via `DATABASE_PROVIDER=sqlite` + manual migration regen.
4. [x] **OQ-4** SSE vs WebSocket for live progress (default: SSE). Affects `GET /schedule-runs/:id/stream` and the frontend transport. **Resolved: SSE selected** via `EventSource` in `src/routes/schedule-runs/[id]/stream/+page.tsx`. SSE is simpler and sufficient for broadcast-style progress updates.
5. [x] **OQ-5** Manual override permission for `user` on completed runs (default: owner-or-admin while COMPLETED). Affects `PUT /schedule-runs/:id/assignments/:aid`. **Implementation**: In `src/routes/schedule-runs/[id]/assignments/[assignmentId]/+server.ts`, the `user` role is allowed to update assignments only if `run.status === "COMPLETED"`. This matches the "owner-or-admin while COMPLETED" rule.
6. [x] **OQ-6** Access / refresh token TTLs (default: 15 min / 7 days). **Resolved: 15 min / 7 days respectively**, implemented in `src/lib/auth.ts`. See `/src/lib/auth.ts` (line ~336 in v31, unchanged in v32). **Note: token-refresh logic not yet wired to the frontend; tokens are refreshed silently via server-side `cookies()` on each request.**
7. [x] **OQ-7** Soft- vs hard-delete for `User` and `ScheduleRun` (default: user soft, run hard). **Resolved: user soft-delete (`status = DELETED`), run hard-delete (no soft-delete column)**. See `src/db/schema.prisma` for both models, and `src/routes/users/[id]/+server.ts` for `DELETE /users/:id` and `PATCH /users/:id`.
8. [x] **OQ-8** Whether to deprecate `CourseOffering.isFixed` post-migration in favor of `LockedRoom` as the single source of truth (default: keep both). **Resolved: keep both for backwards compatibility**. See `src/db/schema.prisma` for `isFixed` on `CourseOffering` and `LockedRoom` as a separate entity. The `isFixed` field is still used in the `computeFeasibleTimeSlots` and `validatePreGAConstraints` steps, while `LockedRoom` provides room-level locking.
9. [x] **OQ-9** Whether to promote competency tags from free-form `string[]` to a Prisma `enum` or relational `Competency` table once the taxonomy stabilizes (default: keep `string[]` for the thesis build). **Resolved: keep `string[]` for now**. The current implementation uses `string[]` in both `Lecturer` and `Course` models (see `src/db/schema.prisma`), and the validation logic in `src/routes/courses/+server.ts` accepts and validates string arrays. Promotion to an enum or relational table is deferred to post-thesis.
