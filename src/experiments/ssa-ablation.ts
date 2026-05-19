/**
 * SSA Ablation Experiment — harness module.
 *
 * Status: SCAFFOLD ONLY. E1.6 (this file's audit header) is complete; the
 * runnable harness lands in E2.11–E2.16 of docs/backlog_experiment.md.
 *
 * ─── Phase E1.6 — Metric Audit ─────────────────────────────────
 *
 * The GA already exposes every metric the ablation report needs without
 * touching the GA hot path. The harness consumes them via (a) the
 * `onGeneration` hook for per-generation data and (b) the returned
 * `GAResult` for final values.
 *
 * | Metric                            | Captured where                                            | Feeds report section |
 * | --------------------------------- | --------------------------------------------------------- | -------------------- |
 * | Best fitness per generation       | `GAResult.history`                  (types.ts:235)        | Results / Convergence plots |
 * | Average fitness per generation    | `GAResult.avgHistory`               (types.ts:236)        | Results / Convergence plots |
 * | Final hard violations             | `GAResult.hardViolations`           (types.ts:233)        | Results table |
 * | Final soft penalty                | `GAResult.softPenalty`              (types.ts:234)        | Results table |
 * | Stagnation flag                   | `GAResult.stagnatedEarly`           (types.ts:237)        | Results / Success rate |
 * | Generations actually run          | `GAResult.generationsRun`           (types.ts:238)        | Results / Convergence |
 * | Per-generation hardViolations     | `GenerationSnapshot.hardViolations` (runGA.ts:31, hook    |                      |
 * |                                   | call at runGA.ts:174–184)                                 | E1.7 firstFeasibleGen derived field |
 * | Per-generation competencyMismatch | `GenerationSnapshot.competencyMismatch` (runGA.ts:33)     | Methodology / sanity check |
 * | Per-generation structural penalty | `GenerationSnapshot.structuralPenalty`  (runGA.ts:34)     | (optional, not needed) |
 * | Per-generation preference penalty | `GenerationSnapshot.preferencePenalty`  (runGA.ts:35)     | (optional, not needed) |
 *
 * Caveats:
 *   - `competencyMismatch` is NOT on `GAResult` (only on the per-generation
 *     snapshot). If the report needs a final-value summary, the harness must
 *     read the LAST snapshot from its own captured stream.
 *   - `history`/`avgHistory` are the BEST-PER-GEN and AVG-PER-GEN of fitness
 *     only. They do not record hard/soft components separately at the
 *     final-result level — those are only available per-snapshot via the hook.
 *   - The hook fires BEFORE stagnation / perfect-solution exits so the harness
 *     sees every generation that ran without gaps.
 *
 * Gaps that require new instrumentation (handled in subsequent E1 tasks):
 *   - First generation where `hardViolations === 0`           → E1.7 (harness-side, no GA change)
 *   - Per-phase wall-clock (preGA / ssa / ga)                 → E1.8 (orchestrator + types.ts)
 *   - "What SSA would have pruned" counterfactual telemetry   → E1.9 (harness-side)
 *
 * GA seed control decision (E1.10): RESOLVED to N=30 statistical reproducibility,
 * no seedable RNG refactor. The GA stays Math.random()-based.
 */

import type { GAHooks, GenerationSnapshot } from "../ga/runGA.js";
import { runStaticExclusion } from "../ssa/staticExclusion.js";
import { runSSA } from "../ssa/index.js";
import type { PreGACandidate, TimeSlot } from "../types.js";

/**
 * Returns the generation number of the first snapshot with `hardViolations === 0`,
 * or `null` if no snapshot in the stream reached feasibility.
 *
 * Generations are 1-indexed in `GenerationSnapshot.generation` (see
 * `src/ga/runGA.ts:178` — the hook fires `generation: gen + 1`). The returned
 * value preserves that 1-indexed convention, so `firstFeasibleGeneration === 1`
 * means the initial population (after repair) already produced a feasible
 * chromosome.
 *
 * The harness collects snapshots via `GAHooks.onGeneration` (E2 task 11).
 * Reason this lives outside the GA core: it is a pure post-processing pass,
 * has no value to the GA loop itself, and would needlessly couple the
 * algorithm to the ablation report.
 */
export function firstFeasibleGeneration(
  snapshots: readonly GenerationSnapshot[]
): number | null {
  for (const s of snapshots) {
    if (s.hardViolations === 0) return s.generation;
  }
  return null;
}

/**
 * Counterfactual telemetry: what SSA *would* have done on this input.
 *
 * Computed by the harness even on bypass-mode runs (E1 task 9 of
 * docs/backlog_experiment.md) so the report can quantify the "opportunity
 * cost of skipping SSA" — domain coordinates the GA never gets pruned,
 * and runs SSA would have caught as structurally infeasible before any
 * GA cycle was spent.
 */
export interface SsaCounterfactual {
  /** Size of `runStaticExclusion(candidates).lockedCoordinates`. */
  wouldHavePrunedCoordinates: number;
  /** True iff a separate `runSSA(...)` would have returned status `'INFEASIBLE'`. */
  wouldHaveDeclaredInfeasible: boolean;
}

/**
 * Re-runs SSA's Phase 0 (static exclusion) and the full SSA pipeline against
 * the same Pre-GA candidates the orchestrator handed to the GA. Returns the
 * counterfactual signal the report uses to justify SSA.
 *
 * Pass `timeSlots` so `runSSA` builds the multi-slot bipartite graph the
 * same way the orchestrator would have — otherwise SSA falls back to the
 * legacy per-slot graph and the infeasibility verdict differs from a
 * canonical run (see `src/ssa/index.ts:16-21`).
 *
 * Pure and safe to call from any context — no GA-loop or orchestrator
 * dependency, no I/O.
 */
export function computeSsaCounterfactual(
  candidates: readonly PreGACandidate[],
  timeSlots: readonly TimeSlot[],
): SsaCounterfactual {
  // `runStaticExclusion` and `runSSA` accept `PreGACandidate[]` and
  // `TimeSlot[]` (mutable). The helper's signature is `readonly` to keep
  // callers honest; spread once to satisfy the underlying signatures.
  const exclusion = runStaticExclusion([...candidates]);
  const ssa = runSSA([...candidates], [...timeSlots]);
  return {
    wouldHavePrunedCoordinates: exclusion.lockedCoordinates.size,
    wouldHaveDeclaredInfeasible: ssa.status === "INFEASIBLE",
  };
}

// ─── E2.11 — Harness scaffold ─────────────────────────────────────
// Types below are intentionally minimal. E2.12 fleshes out RunRecord;
// E3.17–E3.21 supplies the scenario manifest from `./scenarios.js`.

import type { CourseOffering, GAConfig, Lecturer, Room } from "../types.js";
import { runPipeline } from "../orchestrator.js";

/**
 * One ablation scenario — a named composition of seed inputs that the harness
 * sweeps `{withSSA, withoutSSA} × repetitions` times. The full manifest lands
 * in E3 (`src/experiments/scenarios.ts` exporting `ALL_SCENARIOS`). E2.11
 * defines the shape and provides one inline smoke-mode scenario.
 */
export interface ScenarioSpec {
  /** Stable identifier used in the output JSON (e.g., `'feasible-easy'`). */
  readonly id: string;
  /** Human-readable label for logs and reports. */
  readonly label: string;
  /** Builds the orchestrator input for this scenario. Pure — call per run. */
  readonly build: () => {
    offerings: CourseOffering[];
    timeSlots: import("../types.js").TimeSlot[];
    rooms: Room[];
    lecturers: Lecturer[];
  };
}

export interface AblationOpts {
  /** Number of times to repeat each (scenario, mode) combo. Backlog default: 30. */
  repetitions: number;
  /** Scenarios to sweep. Required at runtime; the smoke entry point supplies a built-in. */
  scenarios: ScenarioSpec[];
  /** Optional partial GAConfig override layered on top of the default. */
  gaConfigOverrides?: Partial<GAConfig>;
  /** Absolute path where the harness writes summary.json (and later raw-runs.jsonl/csv). */
  outputDir: string;
}

/**
 * Per-run output record — the JSON shape emitted to `raw-runs.jsonl` /
 * `raw-runs.csv` (E2.13 writers) and consumed by the report tables (E4).
 *
 * Schema set by E2 task 12 of `docs/backlog_experiment.md`. Every field is
 * always populated; numeric fields default to `0` when the underlying layer
 * did not run, except `firstFeasibleGeneration` which is `null` when the
 * GA never reached `hardViolations === 0` (or did not run at all).
 *
 * `ssaWouldHavePrunedCoordinates` and `ssaWouldHaveDeclaredInfeasible` are
 * the counterfactual SSA telemetry from E1.9 — they describe what SSA WOULD
 * have done on this input, irrespective of whether the orchestrator actually
 * ran SSA. They are identical across `with-ssa` and `without-ssa` modes for
 * the same `(scenarioId, repetitionIndex)` because both modes start from
 * the same Pre-GA candidate set.
 */
export interface RunRecord {
  // ─── Identity
  scenarioId: string;
  mode: "with-ssa" | "without-ssa";
  repetitionIndex: number;

  // ─── Pipeline outcome
  status: "SUCCESS" | "INFEASIBLE" | "NO_FEASIBLE_CANDIDATES";

  // ─── GA result (null when GA did not run — INFEASIBLE / NO_FEASIBLE_CANDIDATES)
  bestFitness: number | null;
  hardViolations: number | null;
  softPenalty: number | null;
  generationsRun: number | null;
  stagnatedEarly: boolean | null;

  // ─── Convergence derived field (null when GA never reached feasibility or did not run)
  firstFeasibleGeneration: number | null;

  // ─── Wall-clock split (`0` when the layer did not run)
  preGADurationMs: number;
  ssaDurationMs: number;
  gaDurationMs: number;
  totalDurationMs: number;

  // ─── Counterfactual SSA telemetry (E1.9 — same value for both modes of a given rep)
  ssaWouldHavePrunedCoordinates: number;
  ssaWouldHaveDeclaredInfeasible: boolean;
}

export interface AblationReport {
  startedAt: string;
  finishedAt: string;
  repetitions: number;
  scenarioCount: number;
  totalRuns: number;
  records: RunRecord[];
}

/**
 * Hyperparameters mirror the CLI's `buildConfig` in `src/cli/run-pipeline.ts:32-44`.
 * The smoke entry point overrides `generations` for speed; production harness
 * runs use this baseline plus any `gaConfigOverrides` the caller layers in.
 */
const DEFAULT_GA_CONFIG: GAConfig = {
  populationSize: 80,
  generations: 200,
  mutationRate: 0.1,
  elitismCount: 3,
  tournamentSize: 4,
  crossoverType: "singlePoint",
  noiseRate: 0.15,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
};

async function executeSingleRun(
  scenario: ScenarioSpec,
  mode: "with-ssa" | "without-ssa",
  repetitionIndex: number,
  baseConfig: GAConfig,
): Promise<RunRecord> {
  const built = scenario.build();
  const config: GAConfig = { ...baseConfig, skipSSA: mode === "without-ssa" };

  const snapshots: GenerationSnapshot[] = [];
  const hooks: GAHooks = {
    onGeneration: (snapshot) => {
      snapshots.push(snapshot);
    },
  };

  const realLog = console.log;
  const realWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  let response;
  let candidates: PreGACandidate[] = [];
  try {
    const out = await runPipeline({
      offerings: built.offerings,
      timeSlots: built.timeSlots,
      rooms: built.rooms,
      lecturers: built.lecturers,
      config,
      hooks,
    });
    response = out.response;
    candidates = out.context.candidates;
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }

  const counterfactual = candidates.length > 0
    ? computeSsaCounterfactual(candidates, built.timeSlots)
    : { wouldHavePrunedCoordinates: 0, wouldHaveDeclaredInfeasible: false };

  return {
    scenarioId: scenario.id,
    mode,
    repetitionIndex,
    status: response.status,
    bestFitness: response.gaResult?.bestFitness ?? null,
    hardViolations: response.gaResult?.hardViolations ?? null,
    softPenalty: response.gaResult?.softPenalty ?? null,
    generationsRun: response.gaResult?.generationsRun ?? null,
    stagnatedEarly: response.gaResult?.stagnatedEarly ?? null,
    firstFeasibleGeneration: firstFeasibleGeneration(snapshots),
    preGADurationMs: response.preGADurationMs ?? 0,
    ssaDurationMs: response.ssaDurationMs ?? 0,
    gaDurationMs: response.gaDurationMs ?? 0,
    totalDurationMs: response.durationMs,
    ssaWouldHavePrunedCoordinates: counterfactual.wouldHavePrunedCoordinates,
    ssaWouldHaveDeclaredInfeasible: counterfactual.wouldHaveDeclaredInfeasible,
  };
}

export async function runAblationExperiment(opts: AblationOpts): Promise<AblationReport> {
  const startedAt = new Date().toISOString();
  const records: RunRecord[] = [];
  const baseConfig: GAConfig = { ...DEFAULT_GA_CONFIG, ...(opts.gaConfigOverrides ?? {}) };
  const modes: ReadonlyArray<"with-ssa" | "without-ssa"> = ["with-ssa", "without-ssa"];

  for (const scenario of opts.scenarios) {
    for (const mode of modes) {
      for (let rep = 0; rep < opts.repetitions; rep += 1) {
        const record = await executeSingleRun(scenario, mode, rep, baseConfig);
        records.push(record);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    startedAt,
    finishedAt,
    repetitions: opts.repetitions,
    scenarioCount: opts.scenarios.length,
    totalRuns: records.length,
    records,
  };
}

// ─── Smoke-mode CLI entry ────────────────────────────────────────
// `tsx src/experiments/ssa-ablation.ts --smoke` produces a fast 2-rep
// run against an inline canonical-seed scenario and writes a summary
// JSON file under `outputDir`. The full harness CLI (with --dry-run /
// --parallelism / structured logging / CSV writers) lands in E2.13–E2.15.

// Project is CommonJS (`"type": "commonjs"` in package.json), so use the
// classic `require.main === module` idiom rather than `import.meta.url`.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
const isMain = typeof require !== "undefined" && require.main === module;

if (isMain && process.argv.includes("--smoke")) {
  void (async () => {
    const { rooms, timeSlots, lecturers, courseOfferings } = await import("../db/seed.js");

    const smokeScenario: ScenarioSpec = {
      id: "smoke-feasible",
      label: "Smoke / canonical-feasible seed (E2.11 placeholder)",
      build: () => ({
        offerings: courseOfferings,
        timeSlots,
        rooms,
        lecturers,
      }),
    };

    const outputDir = `${process.cwd()}/docs/experiments/data`;

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(outputDir, { recursive: true });

    console.log("[ssa-ablation] smoke mode — 2 reps × 2 modes × 1 scenario");
    const report = await runAblationExperiment({
      repetitions: 2,
      scenarios: [smokeScenario],
      gaConfigOverrides: { generations: 20, populationSize: 20 },
      outputDir,
    });

    const outPath = `${outputDir}/smoke-summary.json`;
    await writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(`[ssa-ablation] smoke complete — ${report.totalRuns} runs → ${outPath}`);
  })().catch((err) => {
    console.error("[ssa-ablation] smoke failed:", err);
    process.exitCode = 1;
  });
}
