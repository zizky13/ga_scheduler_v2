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
| `test`     | `npm test`         | Runs the [Vitest](https://vitest.dev/) suite once (`vitest run`) against `tests/**/*.test.ts` and exits non-zero on failure. Currently only a smoke test is wired up; Layer 1/2/3 suites land in Phase 0 tasks 6–9.    |
| `test:watch` | `npm run test:watch` | Vitest in watch mode — re-runs the suite as `tests/**/*.test.ts` or imported `src/` files change. Useful while authoring the upcoming Layer 1/2/3 suites.                                                          |

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
