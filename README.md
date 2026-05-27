# ga_scheduler_v2

> A full-stack university course scheduling system for Universitas Pembangunan Jaya (UPJ) that combines deterministic feasibility analysis with a Genetic Algorithm to produce conflict-free class timetables. The backend exposes a REST API backed by PostgreSQL, Redis, and a BullMQ worker. The frontend is a React SPA with real-time run progress, CRUD management for all scheduling entities, and a timetable viewer.

This is a final-year thesis ("Tugas Akhir") project. It implements the runtime described in `docs/techspec_upj_scheduler_v2.md` (arc42 Tech Spec, aligned to PRD v6.0). The system spans the full scheduling lifecycle: data management via a RESTful API, asynchronous GA execution via a BullMQ worker, real-time progress streaming over SSE, post-run manual assignment overrides, and a production frontend for end-to-end usage.

---

## Why This Exists

Course timetabling at UPJ's Faculty of Technology and Design is a combinatorial NP-Hard problem (search space ~800,000+ combinations before constraint filtering). Running a Genetic Algorithm directly on bad inputs wastes minutes of compute and can return "best" schedules that still violate hard constraints. This project addresses that with a **three-layer pipeline** that proves a solution can exist _before_ searching for one:

1. **Layer 1 -- Pre-GA Policy Engine** (deterministic, O(n)): seven per-offering checks (integrity, room capacity, temporal, facility, lecturer, competencies, policy), then entity tagging that marks each candidate as `Fixed Room` or `Flexible`. The competency check is the primary gate that filters out lecturer assignments whose declared expertise does not cover the course's required competencies.
2. **Layer 2 -- Static Structural Analysis / SSA** (deterministic, O(E*sqrt(V))): static exclusion of locked `(room, slot)` coordinates, AC-3 constraint propagation, and Hopcroft-Karp maximum bipartite matching as a global feasibility proof.
3. **Layer 3 -- GA Core** (probabilistic, O(g * p * n)): an asynchronous evolutionary loop with `Fixed`/`Flexible` masked gene operators, three swappable crossover strategies (`singlePoint`, `uniform`, `pmx`), repair, mutation, tournament selection, elitism, stagnation-based early exit, and cooperative cancellation via Redis.

A core design rule (encoded as a TypeScript discriminated union in `src/types.ts`) is that **`Fixed Room` genes must never have their `roomId` mutated by GA operators** -- only the time-slot dimension may evolve.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode, `target: ES2022`, `module: NodeNext`) |
| Runtime | Node.js 18+, executed via [`tsx`](https://tsx.is/) |
| Web framework | Express 5 |
| Database | PostgreSQL via Prisma ORM |
| Job queue | BullMQ (Redis-backed) |
| Cache / Pub-Sub | Redis (ioredis) |
| Auth | JWT (HS256) access tokens + httpOnly refresh-token cookies, bcrypt-12 passwords |
| Validation | Zod 4 |
| API docs | OpenAPI 3.1 (auto-generated via `@asteasolutions/zod-to-openapi`) |
| Logging | Pino + pino-http (structured JSON) |
| Frontend | React 19, React Router 7, Vite 8, Zustand 5, Recharts, Lucide icons |
| Styling | CSS Modules with design-system tokens (light/dark mode) |
| Testing | Vitest |

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** 14+ (the Prisma schema uses `TEXT[]` columns -- any Postgres that supports array types works)
- **Redis** 6+ (used by BullMQ for job queuing and by ioredis for real-time pub/sub progress events)

---

## Infrastructure Setup

The API server and worker require PostgreSQL and Redis to be running. This section walks through getting both services up from scratch.

### 1. PostgreSQL

**macOS (Homebrew):**

```bash
brew install postgresql@16
brew services start postgresql@16

# Create the database
createdb ga_scheduler_v2
```

**Ubuntu / Debian:**

```bash
sudo apt update && sudo apt install postgresql
sudo systemctl start postgresql

# Create a user and database
sudo -u postgres createuser --interactive   # follow prompts
sudo -u postgres createdb ga_scheduler_v2
```

**Windows:**

Download the installer from https://www.postgresql.org/download/windows/, run through the setup wizard, then create the database via pgAdmin or `psql`:

```sql
CREATE DATABASE ga_scheduler_v2;
```

Once the database exists, note your connection string. It follows this format:

```
postgresql://<user>:<password>@localhost:5432/ga_scheduler_v2?schema=public
```

### 2. Redis

BullMQ uses Redis as its job queue backend. The SSE progress stream and cooperative cancellation also use Redis pub/sub.

**macOS (Homebrew):**

```bash
brew install redis
brew services start redis
```

**Ubuntu / Debian:**

```bash
sudo apt update && sudo apt install redis-server
sudo systemctl start redis-server
```

**Windows:**

Redis does not officially support Windows. Use one of these options:

- **WSL2** (recommended): install Ubuntu via WSL, then follow the Ubuntu instructions above.
- **Memurai**: a Redis-compatible Windows-native alternative (https://www.memurai.com/).
- **Docker**: `docker run -d --name redis -p 6379:6379 redis:7-alpine`

**Docker (any OS):**

If you prefer not to install Redis directly:

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

Verify Redis is running:

```bash
redis-cli ping
# Expected: PONG
```

The application connects to `redis://127.0.0.1:6379` by default. Set `REDIS_URL` in `.env` if your Redis is on a different host or port.

### 3. Backend dependencies

```bash
npm install
```

There is no build step -- `tsx` executes TypeScript sources directly.

### 4. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 5. Environment configuration

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

**Required variables:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string for Prisma | `postgresql://user:pass@localhost:5432/ga_scheduler_v2?schema=public` |
| `JWT_SECRET` | HS256 symmetric key for signing JWT access tokens | _(see below)_ |

Generate a `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Optional variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | API server listen port |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection for BullMQ and pub/sub |
| `DATABASE_PROVIDER` | _(unset = postgres)_ | Set to `sqlite` only for the thesis-defense fallback build |

### 6. Database migrations and seed

Apply the Prisma schema to your PostgreSQL database and load the fixture data:

```bash
# Generate the Prisma client
npx prisma generate

# Apply all migrations
npx prisma migrate deploy

# Seed the database with the canonical fixture
# (1 semester, 6 rooms, 60 time slots, 8 lecturers, 11 courses, 15 offerings)
npm run db:seed
```

Append `-- --with-infeasible` to `db:seed` to also load the 4 intentionally infeasible offerings used by integration tests:

```bash
npm run db:seed -- --with-infeasible
```

### 7. Verify everything is connected

Start the API server and confirm the readiness probe:

```bash
npm run api:dev
```

In another terminal:

```bash
# Health check (no dependencies needed)
curl http://localhost:3000/api/v1/health
# {"status":"ok","uptimeSec":...}

# Readiness probe (verifies both DB and Redis are reachable)
curl http://localhost:3000/api/v1/ready
# {"status":"ready","checks":{"db":"ok","redis":"ok"}}
```

If `db` or `redis` shows `"fail"`, check that the respective service is running and that your `.env` values are correct.

### 8. Demo database isolation (optional)

Git branches isolate **code**, not **database state**. If you run `npx prisma migrate dev` on a fix branch and the migration alters a table, your local PostgreSQL is permanently changed. Checking out the demo branch afterwards will surface schema mismatches — the demo code expects the old shape, but the DB has the new one.

To keep a presentable demo build that survives experimental schema work on other branches, point the demo at its own database (`ga_scheduler_v2_demo`) and snapshot the current dev state into it.

#### Initial setup (snapshot the dev DB)

```bash
# 1. Create a second PostgreSQL database alongside the dev one
createdb ga_scheduler_v2_demo

# 2. Copy the template and fill in the demo connection string
cp .env.demo.example .env.demo
# Edit .env.demo so DATABASE_URL ends in /ga_scheduler_v2_demo
# (use the same user/password/JWT_SECRET as .env unless you need them to differ)

# 3. Clone the current dev DB into the demo DB
npm run db:clone:demo
```

`db:clone:demo` (`scripts/clone-dev-to-demo.mjs`) reads both `.env` and `.env.demo`, force-disconnects any open sessions on the demo DB, drops and recreates it, then pipes `pg_dump <dev> | psql <demo>`. The result is a bit-for-bit copy: schema, data, sequences, `_prisma_migrations` rows, users — everything. Same admin credentials work on both DBs because the `users` table comes along for the ride.

#### Running the demo build

Use the `*:demo` scripts to point any process at the demo DB:

```bash
npm run check:migrations:demo  # status against the demo DB
npm run api:dev:demo           # API server pointing at the demo DB
npm run worker:demo            # GA worker pointing at the demo DB
```

These wrap the regular commands with `dotenv -e .env.demo`, so the demo DB is never touched unless you explicitly call a `:demo` script (or `db:clone:demo`). Migrations you run on fix/feature branches go to the dev DB only and leave the demo build intact.

Note: Redis (BullMQ jobs) is still shared. If demo and dev run simultaneously you may want to set a different `REDIS_URL` or a BullMQ queue prefix in `.env.demo`.

#### Rolling-demo workflow

The intended pattern: **demo tracks `main`**. Fix/feature branches stay isolated from the demo DB while in progress; when a fix merges into `main` (and is applied to your dev DB), re-clone to roll the demo forward.

**A. Starting a fix (don't touch the demo DB yet)**

```bash
git checkout -b fix/whatever
# edit code, change schema.prisma, etc.
npx prisma migrate dev --name your_fix   # applies to DEV DB only (.env)
```

Migration files exist on the fix branch only. The demo DB stays on the pre-fix snapshot, matching `main`.

**B. Presentation arrives, fix is NOT done**

Nothing to do. The demo DB already matches `main`. Just run:

```bash
git checkout main
npm run api:dev:demo
```

**C. Fix is merged into `main` — roll the demo forward**

```bash
git checkout main
git pull
npx prisma migrate deploy   # apply merged migrations to the DEV DB first
npm run db:clone:demo       # then snapshot dev into demo
npm run api:dev:demo        # verify
```

Re-cloning is the simplest path because it also brings over any dev-side data you've built up (new schedule runs, manually added rooms, etc.). If you'd rather migrate the demo DB in place without overwriting its data, use `npm run db:migrate:demo` instead of `db:clone:demo`.

**Gotcha:** while on a fix branch, never run `*:demo` or `db:clone:demo` — both would propagate your in-progress, unmerged work to the demo DB and defeat the isolation. Use them only at the post-merge promotion step.

**Destructive migrations:** `db:clone:demo` drops and recreates the demo DB every time. Anything you'd added to the demo DB independently of dev will be lost. If you need to preserve demo-only state, use `db:migrate:demo` to migrate in place, or `pg_dump ga_scheduler_v2_demo > snapshot.sql` before cloning.

#### Alternative: empty demo from scratch (no dev data)

If you'd rather start the demo DB empty and populate only the canonical seed:

```bash
npm run db:migrate:demo
npm run db:seed:demo

# Then copy auth users from the dev DB, since the seed does NOT create accounts.
PGPASSWORD='<your-postgres-password>' pg_dump -U zikarnurizky --data-only --table=users ga_scheduler_v2 \
  | PGPASSWORD='<your-postgres-password>' psql -U zikarnurizky -d ga_scheduler_v2_demo
```

The user-copy step is required because `prisma/seed.ts` only populates scheduling fixtures (rooms, time slots, lecturers, courses, offerings) — the `users` table is bootstrapped manually on the dev DB (via the API register flow or direct SQL), so a freshly migrated+seeded demo DB has zero accounts and you cannot log in.

---

## Running

### Full stack (API + Worker + Frontend)

Start all three processes in separate terminals:

```bash
# Terminal 1: API server
npm run api:dev

# Terminal 2: GA pipeline worker
npm run worker

# Terminal 3: Frontend dev server
cd frontend && npm run dev
```

The API server listens on port 3000. The frontend dev server starts on port 5173 and proxies `/api` requests to the backend. Open http://localhost:5173 to use the application.

### CLI runners (standalone, no API/Redis needed)

The CLI scripts run the scheduling layers directly against the in-memory seed fixture (`src/db/seed.ts`):

```bash
npm run layer1     # Pre-GA validator only
npm run layer2     # SSA only (with multiple infeasibility scenarios)
npm run layer3     # Full pipeline, single GA run
npm run pipeline   # Full pipeline, all three crossover strategies
```

---

## How the Services Fit Together

```
                 +-----------+
                 |  Browser  |  http://localhost:5173
                 |  (React)  |  frontend/
                 +-----+-----+
                       |
              Vite dev proxy /api ->
                       |
                 +-----v-----+
                 |  Express   |  npm run api:dev
                 |  API Server|  (src/api/server.ts)
                 +--+----+--++
                    |    |  |
          Prisma    |    |  |  Enqueue job
          queries   |    |  +-------------------+
                    |    |                      |
              +-----v--+ | SSE subscribe   +----v-----+
              |Postgres| +---------------->|  Redis   |
              |  (DB)  |                   | 6379     |
              +--------+                   +----+-----+
                                                |
                                    BullMQ consume
                                                |
                                          +-----v------+
                                          |  BullMQ    |  npm run worker
                                          |  Worker    |  (src/worker/index.ts)
                                          +-----+------+
                                                |
                                    runPipeline (orchestrator.ts)
                                    Layer 1 -> Layer 2 -> Layer 3
                                                |
                                    Persist results to Postgres
                                    Publish progress to Redis pub/sub
```

- **React Frontend** (`cd frontend && npm run dev`): single-page application for login, data management, schedule run creation, real-time progress monitoring, and timetable viewing. Proxies API calls to the backend via Vite's dev server.
- **Express API** (`npm run api:dev`): handles authentication, CRUD, schedule run creation, and SSE streaming. Enqueues GA jobs into BullMQ. Reads results from PostgreSQL.
- **BullMQ Worker** (`npm run worker`): pulls jobs from the `ga-pipeline` Redis queue, runs the three-layer scheduling pipeline, persists results to PostgreSQL, and publishes real-time progress events via Redis pub/sub.
- **PostgreSQL**: stores all persistent data -- users, semesters, rooms, courses, offerings, schedule runs, assignments, fitness history, and audit logs.
- **Redis**: serves three roles:
  1. **Job queue** (BullMQ): reliable job delivery between the API and worker.
  2. **Pub/Sub**: real-time progress events (`ga-progress:<runId>` channel) consumed by the SSE endpoint.
  3. **Key-value**: cooperative cancellation flags (`ga:run:<runId>:cancel`, 10-min TTL) and GA checkpoint snapshots (`ga:run:<runId>:checkpoint`, 1-hour TTL).

### GA hyperparameters

GA configuration (`populationSize`, `generations`, `mutationRate`, `elitismCount`, `tournamentSize`, `crossoverType`, `noiseRate`, `hardPenaltyWeight`, `softPenaltyWeight`) is passed as a `GAConfig` JSON body when creating a schedule run via the API. For CLI runners, hyperparameters are hard-coded in the respective `src/cli/run-*.ts` files.

---

## Available Scripts

### Backend (from repository root)

| Script | Command | What it does |
|--------|---------|-------------|
| `api:dev` | `npm run api:dev` | Starts the Express API server on `PORT` (default 3000) |
| `worker` | `npm run worker` | Starts the BullMQ worker that processes GA pipeline jobs |
| `layer1` | `npm run layer1` | Runs the Pre-GA validator on the mock seed |
| `layer2` | `npm run layer2` | Runs the SSA layer in isolation across five test scenarios |
| `layer3` | `npm run layer3` | Runs Layer 1 -> Layer 2 -> Layer 3 (single GA run) |
| `pipeline` | `npm run pipeline` | Full three-layer pipeline across all crossover strategies |
| `db:seed` | `npm run db:seed` | Idempotently upserts the canonical fixture data |
| `test` | `npm test` | Runs the Vitest suite once and exits |
| `test:watch` | `npm run test:watch` | Vitest in watch mode |

### Frontend (from `frontend/`)

| Script | Command | What it does |
|--------|---------|-------------|
| `dev` | `npm run dev` | Starts the Vite dev server on port 5173 with API proxy |
| `build` | `npm run build` | Type-checks and produces a production bundle in `dist/` |
| `preview` | `npm run preview` | Serves the production build locally |
| `lint` | `npm run lint` | Runs ESLint across the frontend source |

---

## Frontend

The frontend is a React 19 single-page application located in `frontend/`. It communicates with the backend REST API and provides a complete management interface for the scheduling system.

### Pages

| Route | Page | Access | Description |
|-------|------|--------|-------------|
| `/login` | LoginPage | Public | Authentication form |
| `/dashboard` | DashboardPage | All users | System overview with stat grids, recent runs, and activity feed |
| `/rooms` | RoomManagementPage | All users | CRUD for classrooms with capacity and facility tags |
| `/timeslots` | TimeslotManagementPage | All users | CRUD for weekly time slot definitions |
| `/lecturers` | LecturerManagementPage | All users | CRUD for lecturers with competencies and preferred slots |
| `/courses` | CourseManagementPage | All users | CRUD for courses with required competencies and facilities |
| `/offerings` | CourseOfferingManagementPage | All users | CRUD for course offerings linking courses, rooms, and lecturers |
| `/runs` | RunHistoryPage | All users | Paginated list of schedule runs with status filters |
| `/runs/new` | RunCreationPage | All users | GA configuration form with pre-flight data summary |
| `/runs/:id` | RunDetailPage | All users | Run detail with real-time SSE progress, fitness chart, and failure panels |
| `/schedule` | ScheduleViewerPage | All users | Timetable grid view of completed schedule assignments |
| `/semesters` | SemesterManagementPage | Admin only | Semester CRUD with activate/deactivate |
| `/facilities` | FacilityManagementPage | Admin only | Facility tag CRUD |
| `/users` | UserManagementPage | Admin only | User account management |
| `/audit-log` | AuditLogPage | Admin only | Audit trail of all state-changing operations |

### Key Components

| Component | Description |
|-----------|-------------|
| `Sidebar` | Fixed-left navigation with grouped items, collapse toggle, responsive mobile drawer |
| `TopBar` | Header with semester selector dropdown, dark mode toggle, and user menu |
| `DataTable` | Generic paginated table with row actions, empty states, and loading skeletons |
| `TableToolbar` | Search input, filter dropdown with apply/reset, active filter pills |
| `Form` | Form primitives: TextInput, NumberInput, Select, DatePicker (calendar grid), TimeInput (HH:MM) |
| `Modal` / `ConfirmDialog` | Overlay dialogs with variant support (warning, danger) |
| `Chart` | Recharts-based fitness curve visualization |
| `TimetableGrid` / `ScheduleGrid` | Weekly Mon-Fri schedule grid with course blocks |
| `Skeleton` | Loading primitives: text, stat value, table cell, avatar, badge, table rows |
| `Toast` | Notification system with auto-dismiss and variant styling |
| `SessionExpiredModal` | Non-dismissable modal triggered on 401 API responses |
| `AccountDisabledModal` | Non-dismissable modal triggered on 403 ACCOUNT_DISABLED responses |

### State Management

| Store | Purpose |
|-------|---------|
| `authStore` | User session, JWT token, login/logout, session-expired and account-disabled flags |
| `semesterStore` | Semester list and active semester selection with activate API |
| `pipelineStore` | In-browser pipeline run state (POC demo mode) |
| `rateLimitStore` | Tracks 429 rate-limit retry-after countdown |
| `toastStore` | Toast notification queue |

---

## API Overview

All endpoints are mounted under `/api/v1`. Authentication uses Bearer JWT tokens. The OpenAPI 3.1 spec is served at `GET /api/v1/openapi.json`.

### Infrastructure

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/health` | No | Health check (uptime) |
| GET | `/api/v1/ready` | No | Readiness probe (DB + Redis ping) |
| GET | `/api/v1/openapi.json` | No | OpenAPI 3.1 document |

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | Admin | Create a new user (admin-only) |
| POST | `/auth/login` | No | Authenticate, returns JWT + sets refresh cookie |
| POST | `/auth/refresh` | Cookie | Rotate refresh token, returns new JWT |
| POST | `/auth/logout` | Bearer | Revoke refresh token, clear cookie |
| GET | `/auth/me` | Bearer | Current user profile |

### CRUD Resources

Standard REST endpoints with pagination, sorting, and role-based access control:

| Resource | Path prefix | Notes |
|----------|------------|-------|
| Users | `/users` | Admin-only management |
| Semesters | `/semesters` | Academic period management; `POST /:id/activate` to set active semester |
| Rooms | `/rooms` | Classrooms with capacity and facility associations |
| Time Slots | `/timeslots` | Weekly time slot definitions (day + HH:MM range) |
| Facilities | `/facilities` | Room/course facility tags (LAB, PROJECTOR, STUDIO) |
| Locked Rooms | `/locked-rooms` | Per-offering room locks (admin pre-run constraint) |
| Lecturers | `/lecturers` | Includes competencies and preferred time slots |
| Courses | `/courses` | Includes required competencies and required facilities |
| Course Offerings | `/course-offerings` | Links courses to semesters with lecturers; supports fixed/flexible flag |

### Schedule Runs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/schedule-runs` | Bearer | Create and enqueue a GA run (202 Accepted). Supports `Idempotency-Key` header. Rate-limited to 5 runs / 5 min per user. |
| GET | `/schedule-runs` | Bearer | List runs with filtering by status/semester, pagination. Users see only their own runs. |
| GET | `/schedule-runs/:id` | Bearer | Full run detail including assignments grouped by offering and nested sessions |
| GET | `/schedule-runs/:id/stream` | Bearer | SSE stream of real-time progress events (`progress`, `state`, `error`) |
| POST | `/schedule-runs/:id/cancel` | Bearer | Cooperative cancellation (sets Redis flag, worker exits between generations) |
| DELETE | `/schedule-runs/:id` | Bearer | Delete a non-running schedule run |
| PUT | `/schedule-runs/:id/assignments/:assignmentId` | Bearer | Manual assignment override (room, time slots, notes) with audit trail |

### Run lifecycle states

```
QUEUED -> RUNNING -> COMPLETED
                  -> STAGNATED (early exit)
                  -> CANCELLED (cooperative)
              -> SSA_INFEASIBLE
              -> PRE_GA_EMPTY
              -> FAILED
```

---

## Architecture

### How the Layers Connect

```
API POST /schedule-runs
   |
   v
BullMQ Queue (ga-pipeline)
   |
   v
Worker (src/worker/index.ts)
   |
   v
runPipeline (src/orchestrator.ts)
   |
   +---> runPreGA(offerings, slots, rooms)   <-- Layer 1 (src/pre-ga/validator.ts)
   |        7 sequential checks + entity tagging
   |        competency filtering (primary gate)
   |        possibleRoomIds computation for flexible offerings
   |        produces: { validation, candidates: PreGACandidate[] }
   |
   +---> runSSA(candidates, slots)           <-- Layer 2 (src/ssa/index.ts)
   |        static exclusion -> AC-3 -> Hopcroft-Karp
   |        gates GA execution; returns DeadlockReport if INFEASIBLE
   |
   +---> runGA(candidates, ...)              <-- Layer 3 (src/ga/runGA.ts)
            async loop with hooks:
              onGeneration -> SSE progress events + fitness history
              shouldCancel -> Redis cancellation polling
              onCheckpoint -> Redis checkpoint snapshots (every 10 generations)
            produces: GAResult { bestChromosome, bestFitness, ... }
   |
   v
Persist ScheduleAssignment rows + FitnessHistory
```

### Worker real-time hooks

The GA loop is asynchronous -- it yields to the event loop between generations via `setImmediate`, enabling three real-time hooks:

- **`onGeneration`**: publishes per-generation progress snapshots via Redis pub/sub, consumed by the SSE endpoint
- **`shouldCancel`**: polls the Redis cancellation key, enabling cooperative mid-run cancellation
- **`onCheckpoint`**: writes full GA state snapshots to Redis every 10 generations (1-hour TTL)

### Eligibility rule (competency match)

A lecturer is **eligible** for a course iff the intersection of `lecturer.competencies` and `course.requiredCompetencies` contains at least one element. If `course.requiredCompetencies` is empty, any lecturer is eligible. The helper `isLecturerEligibleForCourse` lives in `src/pre-ga/checks.ts`.

### Shared-cohort behavior

If you create two offerings for the same course in the same semester, the scheduler treats them as one cohort and splits the sessions across all assigned lecturers. You get a single cohort of N parallel sessions distributed over the union of the offerings' lecturers, not independent runs of each offering. Cohort aggregation lives in `src/pre-ga/validator.ts`.

---

## Project Structure

```
ga_scheduler_v2/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── prisma/
│   ├── schema.prisma                     # Full DB schema (Postgres)
│   ├── seed.ts                           # Idempotent DB seeder
│   └── migrations/                       # Prisma migration history
├── src/
│   ├── types.ts                          # Shared domain types (entities, GA config, results)
│   ├── orchestrator.ts                   # Pipeline composition: PreGA -> SSA -> GA
│   ├── api/
│   │   ├── server.ts                     # Express app factory + standalone entry point
│   │   ├── router.ts                     # /api/v1 route mounting
│   │   ├── errors.ts                     # Typed error classes (AuthError, NotFoundError, ...)
│   │   ├── logger.ts                     # Pino root logger
│   │   ├── middleware/                    # Auth, RBAC, rate limiting, validation, error handling
│   │   ├── routes/                       # Endpoint handlers for all 12 resource routers
│   │   ├── schemas/                      # Zod schemas for request/response validation
│   │   ├── openapi/                      # OpenAPI 3.1 registry and generation
│   │   └── lib/                          # Auth helpers, audit logging, readiness, Prisma errors
│   ├── worker/
│   │   ├── index.ts                      # BullMQ worker: consumes ga-pipeline jobs
│   │   └── progressChannel.ts            # Redis pub/sub event encoding for SSE
│   ├── queue/
│   │   ├── ga-pipeline.ts                # BullMQ queue setup and enqueue helpers
│   │   ├── connection.ts                 # Shared Redis connection for BullMQ
│   │   ├── cancellation.ts              # Redis-backed cancellation flag (set/poll/clear)
│   │   └── checkpoints.ts               # Redis-backed GA checkpoint read/write (1h TTL)
│   ├── repo/                             # Prisma repository layer
│   │   ├── prisma.ts                     # PrismaClient singleton
│   │   ├── *Repo.ts                      # Per-entity query modules
│   │   ├── competencyCodec.ts           # Dual-target encoding (Postgres TEXT[] / SQLite JSON)
│   │   └── mappers/                     # Prisma row -> domain type mappers
│   ├── pre-ga/                           # Layer 1: Pre-GA Policy Engine
│   │   ├── checks.ts                     # 7 validation checks (incl. competency match)
│   │   ├── validator.ts                  # Orchestrator + PreGACandidate construction
│   │   └── entityTagger.ts              # Stamps isFixedRoom from lockedRoomMap
│   ├── ssa/                              # Layer 2: Static Structural Analysis
│   │   ├── index.ts                      # SSA orchestrator (Phase 0 -> AC-3 -> Hopcroft-Karp)
│   │   ├── staticExclusion.ts           # Phase 0: prune locked (room, slot) coordinates
│   │   ├── bipartiteGraph.ts            # Build session <-> slot adjacency
│   │   ├── ac3.ts                       # Phase 1: AC-3 constraint propagation
│   │   └── hopcroftKarp.ts              # Phase 2: maximum bipartite matching
│   ├── ga/                               # Layer 3: GA Core
│   │   ├── runGA.ts                      # Async evolutionary loop with hooks and stagnation exit
│   │   ├── chromosome.ts                # Gene factories (FIXED / FLEXIBLE), slot lookup
│   │   ├── population.ts                # Initial population generation
│   │   ├── selection.ts                 # Tournament selection
│   │   ├── crossover.ts                 # singlePoint, uniform, pmx
│   │   ├── mutation.ts                  # Slot mutation (room mutation only on FLEXIBLE genes)
│   │   ├── repair.ts                    # Post-operator chromosome repair
│   │   └── fitness.ts                   # Weighted fitness with competency mismatch counter
│   ├── cli/                              # Standalone CLI runners (no API/Redis needed)
│   │   ├── run-layer1.ts
│   │   ├── run-layer2.ts
│   │   ├── run-layer3.ts
│   │   ├── run-pipeline.ts
│   │   └── _format.ts                   # CLI output formatting
│   └── db/
│       └── seed.ts                       # In-memory mock seed (used by CLI runners and tests)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts                    # Dev proxy, @pipeline alias, .js->.ts resolver
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                      # React root entry point
│       ├── App.tsx                       # Route definitions + AppShell layout
│       ├── pages/                        # 15 page components (see Frontend section)
│       ├── components/                   # 20 reusable UI components
│       ├── store/                        # 5 Zustand stores (auth, semester, pipeline, rateLimit, toast)
│       ├── hooks/                        # Custom hooks (useRateLimitCountdown)
│       ├── lib/                          # API client, SSE stream hook, theme hook, polyfills
│       └── styles/                       # Design tokens, breakpoints
├── tests/                                # 44 test files across all layers
│   ├── smoke.test.ts
│   ├── integration/
│   │   ├── integration.test.ts           # Layer 3 integration (convergence, stagnation, elitism)
│   │   └── blackbox.test.ts              # 11 black-box scenarios (techspec §10.2)
│   ├── ga/                               # Crossover, fitness, contiguous slots
│   ├── ssa/                              # AC-3, bipartite graph, Hopcroft-Karp, static exclusion
│   ├── pre-ga/                           # Layer 1 checks
│   ├── orchestrator/                     # Pipeline composition
│   ├── api/                              # Server, OpenAPI, readiness, middleware, schemas, routes
│   ├── queue/                            # BullMQ queue, checkpoints
│   ├── worker/                           # Worker job processing, progress channel
│   ├── repo/                             # Mappers, competency codec
│   └── db/                               # Prisma seed
└── docs/
    ├── techspec_upj_scheduler_v2.md      # Technical specification (arc42, v2.0)
    ├── api_and_database_design.md        # API + DB design document
    ├── app-design-spec.md                # Frontend design specification
    ├── erd.md                            # Entity relationship diagram
    ├── backlog.md                        # Development backlog (Phases 0-6)
    └── blackbox-test-documentation.md    # Black-box test plan and results
```

---

## Testing

```bash
# Run the full suite once (from repository root)
npm test

# Watch mode
npm run test:watch

# Run only the black-box integration tests
npx vitest run tests/integration/blackbox.test.ts

# Run only the Layer 3 integration tests
npx vitest run tests/integration/integration.test.ts
```

The test suite (44 files) covers:

- **GA layer**: crossover operators (masking invariant assertions), fitness evaluation, contiguous slot finding
- **SSA layer**: AC-3 constraint propagation, bipartite graph construction, Hopcroft-Karp matching, static exclusion
- **Pre-GA layer**: all 7 validation checks, competency matching edge cases
- **Orchestrator**: pipeline composition, pre-GA summary format
- **API**: server setup, OpenAPI spec, readiness probe, rate limiting, permission middleware, Zod schemas, and route-level tests for all 12 resource routers (auth, users, semesters, rooms, timeslots, facilities, locked-rooms, lecturers, courses, course-offerings, schedule-runs, audit-logs)
- **Queue**: BullMQ queue setup, checkpoint read/write
- **Worker**: job processing lifecycle, progress channel encoding
- **Repository**: Prisma mappers, competency codec, schedule assignment mapping
- **Integration**: end-to-end Layer 3 tests (convergence, stagnation exit, fixed room invariant, elitism monotonicity)
- **Black-box (§10.2)**: 11 scenarios exercising the full `runPipeline` as a black box for thesis Chapter 4 validation -- feasible simple, SSA Phase 0 trigger, AC-3 abort, Hopcroft-Karp abort, partial infeasibility, parallel class, team teaching, fixed room invariant, competency mismatch, competency open assignment, crossover comparison

See `docs/blackbox-test-documentation.md` for detailed scenario descriptions, inputs, expected outputs, and results.

---

## Spec Documents

| Document | Location | Description |
|----------|----------|-------------|
| Technical Specification | `docs/techspec_upj_scheduler_v2.md` | arc42 Tech Spec v2.0 aligned to PRD v6.0. Covers architecture, constraint catalogue, complexity analysis, and ADRs. Start here. |
| API & Database Design | `docs/api_and_database_design.md` | API design, database schema, Zod validation rules, RBAC matrix, and open-question resolutions. |
| Frontend Design Spec | `docs/app-design-spec.md` | UI design system, component specifications, page layouts, and interaction patterns. |
| Entity Relationship Diagram | `docs/erd.md` | Visual database schema reference. |
| Development Backlog | `docs/backlog.md` | Phased roadmap (Phases 0-6) with task tracking. |
| Black-Box Test Documentation | `docs/blackbox-test-documentation.md` | Detailed test plan for the 11 thesis Chapter 4 scenarios. |

---
