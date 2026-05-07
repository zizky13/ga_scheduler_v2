# ga_scheduler_v2

> A three-layer course scheduling engine for Universitas Pembangunan Jaya (UPJ) that combines deterministic feasibility analysis with a Genetic Algorithm to produce conflict-free class timetables. Exposed through a REST API backed by PostgreSQL, Redis, and a BullMQ worker.

This is the backend for a final-year thesis ("Tugas Akhir") project. It implements the runtime described in `techspec_upj_scheduler_v2.md` (arc42 Tech Spec, aligned to PRD v6.0). The system spans the full scheduling lifecycle: data management via a RESTful API, asynchronous GA execution via a BullMQ worker, real-time progress streaming over SSE, and post-run manual assignment overrides.

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

### 3. Node.js dependencies

```bash
npm install
```

There is no build step -- `tsx` executes TypeScript sources directly.

### 4. Environment configuration

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

### 5. Database migrations and seed

Apply the Prisma schema to your PostgreSQL database and load the fixture data:

```bash
# Generate the Prisma client
npx prisma generate

# Apply all migrations
npx prisma migrate deploy

# Seed the database with the canonical fixture
# (1 semester, 6 rooms, 15 time slots, 8 lecturers, 11 courses, 15 offerings)
npm run db:seed
```

Append `-- --with-infeasible` to `db:seed` to also load the 4 intentionally infeasible offerings used by integration tests:

```bash
npm run db:seed -- --with-infeasible
```

### 6. Verify everything is connected

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

---

## How the Services Fit Together

```
                 +-----------+
                 |  Client   |
                 +-----+-----+
                       |
              HTTP REST / SSE
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

## Running

### API server + worker (production path)

Start the Express API and the BullMQ worker as two separate processes:

```bash
# Terminal 1: API server
npm run api:dev

# Terminal 2: GA pipeline worker
npm run worker
```

The API server listens on `PORT` (default 3000). The worker consumes jobs from the `ga-pipeline` BullMQ queue and drives the `runPreGA -> runSSA -> runGA` pipeline.

### CLI runners (standalone, no API/Redis needed)

The CLI scripts run the scheduling layers directly against the in-memory seed fixture (`src/db/seed.ts`):

```bash
npm run layer1     # Pre-GA validator only
npm run layer2     # SSA only (with multiple infeasibility scenarios)
npm run layer3     # Full pipeline, single GA run
npm run pipeline   # Full pipeline, all three crossover strategies
```

---

## Available Scripts

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
| Semesters | `/semesters` | Academic period management |
| Rooms | `/rooms` | Scoped to semester |
| Time Slots | `/timeslots` | Scoped to semester |
| Facilities | `/facilities` | Room/course facility tags |
| Locked Rooms | `/locked-rooms` | Per-offering room locks |
| Lecturers | `/lecturers` | Includes competencies and preferred slots |
| Courses | `/courses` | Includes required competencies and facilities |
| Course Offerings | `/course-offerings` | Links courses to semesters with lecturers |

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
   +---> runPreGA(offerings, slots)      <-- Layer 1 (src/pre-ga/validator.ts)
   |        competency filtering (primary gate)
   |        produces: { validation, candidates: PreGACandidate[] }
   |
   +---> runSSA(candidates, slots)       <-- Layer 2 (src/ssa/index.ts)
   |        static exclusion -> AC-3 -> Hopcroft-Karp
   |        gates GA execution; returns DeadlockReport if INFEASIBLE
   |
   +---> runGA(candidates, ...)          <-- Layer 3 (src/ga/runGA.ts)
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
│   │   ├── middleware/
│   │   │   ├── auth.ts                   # requireAuth (JWT), requireRole
│   │   │   ├── permissions.ts            # requireOwnerOrAdmin, allowFields
│   │   │   ├── rateLimit.ts              # Per-user rate limiting (auth + run creation)
│   │   │   ├── validate.ts               # Zod request validation
│   │   │   ├── requestId.ts              # X-Request-Id propagation
│   │   │   └── errorHandler.ts           # Global error handler + 404
│   │   ├── routes/
│   │   │   ├── auth.ts                   # Register, login, refresh, logout, me
│   │   │   ├── users.ts                  # User CRUD (admin-only)
│   │   │   ├── semesters.ts              # Semester CRUD
│   │   │   ├── rooms.ts                  # Room CRUD
│   │   │   ├── timeslots.ts              # Time slot CRUD
│   │   │   ├── facilities.ts             # Facility CRUD
│   │   │   ├── locked-rooms.ts           # Locked room CRUD
│   │   │   ├── lecturers.ts              # Lecturer CRUD (with competencies)
│   │   │   ├── courses.ts                # Course CRUD (with required competencies)
│   │   │   ├── course-offerings.ts       # Course offering CRUD
│   │   │   └── schedule-runs.ts          # Run lifecycle: create, list, detail, stream, cancel, delete, override
│   │   ├── schemas/                      # Zod schemas for request/response validation
│   │   ├── openapi/                      # OpenAPI 3.1 registry and generation
│   │   └── lib/                          # Auth helpers, audit logging, readiness checks, Prisma error matchers
│   ├── worker/
│   │   ├── index.ts                      # BullMQ worker: consumes ga-pipeline jobs, drives orchestrator
│   │   └── progressChannel.ts            # Redis pub/sub event encoding for SSE
│   ├── queue/
│   │   ├── ga-pipeline.ts                # BullMQ queue setup and enqueue helpers
│   │   ├── connection.ts                 # Shared Redis connection for BullMQ
│   │   ├── cancellation.ts              # Redis-backed cancellation flag (set/poll/clear)
│   │   └── checkpoints.ts               # Redis-backed GA checkpoint read/write (1h TTL)
│   ├── repo/                             # Prisma repository layer
│   │   ├── prisma.ts                     # Shared PrismaClient singleton
│   │   ├── index.ts                      # Barrel export
│   │   ├── userRepo.ts                   # User queries
│   │   ├── refreshTokenRepo.ts           # Refresh token queries
│   │   ├── semesterRepo.ts               # Semester queries
│   │   ├── roomRepo.ts                   # Room queries
│   │   ├── timeslotRepo.ts               # Time slot queries
│   │   ├── facilityRepo.ts               # Facility queries
│   │   ├── lockedRoomRepo.ts             # Locked room queries
│   │   ├── lecturerRepo.ts               # Lecturer queries (GA input loader)
│   │   ├── lecturerCrudRepo.ts           # Lecturer CRUD for API routes
│   │   ├── courseRepo.ts                 # Course queries (GA input loader)
│   │   ├── courseCrudRepo.ts             # Course CRUD for API routes
│   │   ├── courseOfferingRepo.ts         # Course offering queries
│   │   ├── scheduleRunRepo.ts            # Schedule run queries (list, detail, status updates)
│   │   ├── scheduleAssignmentRepo.ts     # Schedule assignment persistence + override
│   │   ├── scheduleRepo.ts              # GA input loader (loads all entities for a semester)
│   │   ├── auditLogRepo.ts              # Audit log persistence
│   │   ├── competencyCodec.ts           # Dual-target encoding for competency arrays (Postgres/SQLite)
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
│   │   └── fitness.ts                   # Weighted fitness with competency mismatch defense-in-depth
│   ├── cli/                              # Standalone CLI runners (no API/Redis needed)
│   │   ├── run-layer1.ts
│   │   ├── run-layer2.ts
│   │   ├── run-layer3.ts
│   │   ├── run-pipeline.ts
│   │   └── _format.ts                   # CLI output formatting
│   └── db/
│       └── seed.ts                       # In-memory mock seed (used by CLI runners)
├── tests/                                # 43 test files across all layers
│   ├── smoke.test.ts
│   ├── integration/
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
    └── api_and_database_design.md        # API + DB design document
```

---

## Testing

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

The test suite (43 files) covers:

- **GA layer**: crossover operators, fitness evaluation, contiguous slot finding
- **SSA layer**: AC-3, bipartite graph construction, Hopcroft-Karp matching, static exclusion
- **Pre-GA layer**: validation checks, competency matching
- **Orchestrator**: pipeline composition, pre-GA summary format
- **API**: server setup, OpenAPI spec, readiness probe, rate limiting, permission middleware, Zod schemas, and route-level tests for all 11 resource routers (auth, users, semesters, rooms, timeslots, facilities, locked-rooms, lecturers, courses, course-offerings, schedule-runs)
- **Queue**: BullMQ queue setup, checkpoint read/write
- **Worker**: job processing lifecycle, progress channel encoding
- **Repository**: Prisma mappers, competency codec, schedule assignment mapping
- **Integration**: end-to-end pipeline tests

---

## Spec Documents

For the full domain rationale, architecture decisions, constraint catalogue, and complexity analysis, read:

- `techspec_upj_scheduler_v2.md` -- current spec (v2.0, aligned to PRD v6.0). Start here.
- `docs/api_and_database_design.md` -- API design, database schema decisions, and open-question resolutions.
- `technical_spec.md` -- earlier v1.0 of the tech spec, kept for reference.

---
