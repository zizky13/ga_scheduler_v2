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
  /**
   * How many pipeline runs to execute concurrently (E2 task 14). Default `1`
   * = strictly sequential (preserves pre-E2.14 behaviour). Values > 1 process
   * the flat `(scenario, mode, rep)` task list in chunks of size `parallelism`
   * via `Promise.all`. The pipeline is pure and stateless, so concurrent runs
   * are safe; the only shared global is `Math.random()` (process-wide) and
   * concurrent draws will interleave — that's acceptable per the E1.10 decision
   * (N=30 reps wash out RNG variance).
   */
  parallelism?: number;
  /**
   * When `true`, skip all pipeline execution and return a stub `AblationReport`
   * with `totalRuns: 0` and `records: []`. The smoke/CLI entry point prints
   * the run matrix and wall-clock estimate before calling `runAblationExperiment`,
   * so this flag's job is purely to short-circuit execution. No output files
   * are written on dry runs — the JSONL/CSV/summary writers are skipped.
   */
  dryRun?: boolean;
  /**
   * Progress log cadence (E2 task 15). When a run's 1-based completion index
   * is a multiple of `logEveryN` — or it is the final run — the harness emits
   * one line via the *unmuted* `console.log` reference saved before the
   * harness-wide mute kicks in. Default `1` (log every completed run); the
   * smoke run's 4 records all log. Full 240-run sweeps can pass `10` to
   * throttle. Ignored entirely under `dryRun: true`.
   */
  logEveryN?: number;
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

  // NOTE: console.log/warn muting is hoisted to `runAblationExperiment` (E2.14)
  // because per-run save/restore is unsafe under `parallelism > 1` — two
  // concurrent runs both restore `console.log` to their snapshot of `realLog`,
  // but if a third run starts between the snapshot and the restore, it
  // captures the already-muted noop as "real" and pollutes downstream runs.
  // Muting once at the experiment boundary is concurrency-safe.
  const out = await runPipeline({
    offerings: built.offerings,
    timeSlots: built.timeSlots,
    rooms: built.rooms,
    lecturers: built.lecturers,
    config,
    hooks,
  });
  const response = out.response;
  const candidates: PreGACandidate[] = out.context.candidates;

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

// ─── E2.13 — Output writers (raw-runs.jsonl, raw-runs.csv, summary.json) ──

/**
 * Ordered column list for `raw-runs.csv`. Order is the single source of truth
 * for both header row and per-row cell order, so a single typo cannot cause
 * column-mismatch errors when the CSV is opened in Excel / Numbers.
 *
 * Mirrors `RunRecord` exactly; the type-level `satisfies` guard below catches
 * additions/renames at compile time.
 */
const CSV_COLUMNS = [
  "scenarioId",
  "mode",
  "repetitionIndex",
  "status",
  "bestFitness",
  "hardViolations",
  "softPenalty",
  "generationsRun",
  "stagnatedEarly",
  "firstFeasibleGeneration",
  "preGADurationMs",
  "ssaDurationMs",
  "gaDurationMs",
  "totalDurationMs",
  "ssaWouldHavePrunedCoordinates",
  "ssaWouldHaveDeclaredInfeasible",
] as const satisfies ReadonlyArray<keyof RunRecord>;

/**
 * Escape a single CSV cell. Quotes any string containing comma, quote, or
 * newline (RFC 4180 minimal-quoting). Null → empty cell; booleans → literal
 * `true`/`false`; numbers stringified as-is (no thousands separators, no
 * locale formatting — Excel parses them as numbers either way).
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Pure: render one RunRecord as a CSV row (no trailing newline). */
export function recordToCsvRow(record: RunRecord): string {
  return CSV_COLUMNS.map((col) => csvEscape(record[col])).join(",");
}

/** Pure: render the full CSV (header + rows, LF-separated, trailing newline). */
export function recordsToCsv(records: readonly RunRecord[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = records.map(recordToCsvRow);
  return [header, ...body].join("\n") + "\n";
}

export interface NumericAggregate {
  /** Count of finite, non-null values aggregated (nulls are skipped). */
  count: number;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Population standard deviation over the finite subset of `values`.
 * Returns the all-null aggregate when no finite values are present.
 *
 * Nulls and non-finite numbers (`NaN`, `±Infinity`) are skipped. Documented
 * here rather than at each call site so the report's methodology section can
 * cite a single source of truth.
 */
export function aggregate(values: ReadonlyArray<number | null>): NumericAggregate {
  const finite: number[] = [];
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) {
    return { count: 0, mean: null, median: null, stddev: null, min: null, max: null };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = finite.reduce((a, b) => a + b, 0);
  const mean = sum / finite.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const variance = finite.reduce((acc, v) => acc + (v - mean) ** 2, 0) / finite.length;
  const stddev = Math.sqrt(variance);
  return {
    count: finite.length,
    mean,
    median,
    stddev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export interface GroupSummary {
  scenarioId: string;
  mode: "with-ssa" | "without-ssa";
  /** Number of runs in this group (all reps, including failures). */
  n: number;
  /** Fraction with `status === 'SUCCESS'` AND `hardViolations === 0`. */
  successRate: number;
  fitness: NumericAggregate;
  hardViolations: NumericAggregate;
  durations: {
    total: NumericAggregate;
    preGA: NumericAggregate;
    ssa: NumericAggregate;
    ga: NumericAggregate;
  };
  /**
   * First-feasible-generation distribution. `nullCount` is the number of runs
   * that never reached `hardViolations === 0` (or did not run GA at all); the
   * numeric aggregates are over the non-null subset.
   */
  firstFeasibleGeneration: NumericAggregate & { nullCount: number };
}

export interface ExperimentSummary {
  generatedAt: string;
  groups: GroupSummary[];
}

/**
 * Group `records` by `(scenarioId, mode)` and compute aggregates.
 * Pure — safe to call from tests or the smoke entry point without I/O.
 */
export function summarize(records: readonly RunRecord[]): ExperimentSummary {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const key = `${r.scenarioId}::${r.mode}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const out: GroupSummary[] = [];
  for (const [, runs] of groups) {
    const n = runs.length;
    const successes = runs.filter(
      (r) => r.status === "SUCCESS" && r.hardViolations === 0,
    ).length;
    const ffgValues = runs.map((r) => r.firstFeasibleGeneration);
    const ffgNullCount = ffgValues.filter((v) => v === null).length;
    out.push({
      scenarioId: runs[0].scenarioId,
      mode: runs[0].mode,
      n,
      successRate: n > 0 ? successes / n : 0,
      fitness: aggregate(runs.map((r) => r.bestFitness)),
      hardViolations: aggregate(runs.map((r) => r.hardViolations)),
      durations: {
        total: aggregate(runs.map((r) => r.totalDurationMs)),
        preGA: aggregate(runs.map((r) => r.preGADurationMs)),
        ssa: aggregate(runs.map((r) => r.ssaDurationMs)),
        ga: aggregate(runs.map((r) => r.gaDurationMs)),
      },
      firstFeasibleGeneration: {
        ...aggregate(ffgValues),
        nullCount: ffgNullCount,
      },
    });
  }
  out.sort((a, b) =>
    a.scenarioId === b.scenarioId
      ? a.mode.localeCompare(b.mode)
      : a.scenarioId.localeCompare(b.scenarioId),
  );
  return { generatedAt: new Date().toISOString(), groups: out };
}

export async function runAblationExperiment(opts: AblationOpts): Promise<AblationReport> {
  const startedAt = new Date().toISOString();
  const records: RunRecord[] = [];
  const baseConfig: GAConfig = { ...DEFAULT_GA_CONFIG, ...(opts.gaConfigOverrides ?? {}) };
  const modes: ReadonlyArray<"with-ssa" | "without-ssa"> = ["with-ssa", "without-ssa"];
  const parallelism = Math.max(1, Math.floor(opts.parallelism ?? 1));

  // ─── Dry-run short-circuit (E2.14) ─────────────────────────────────
  // Print nothing here — the CLI entry point owns the matrix print so it
  // can format scenario IDs, mode labels, etc. The library just returns a
  // zero-records stub so callers can rely on the same return type.
  if (opts.dryRun) {
    const finishedAt = new Date().toISOString();
    return {
      startedAt,
      finishedAt,
      repetitions: opts.repetitions,
      scenarioCount: opts.scenarios.length,
      totalRuns: 0,
      records: [],
    };
  }

  const { mkdir, writeFile, appendFile, rm } = await import("node:fs/promises");
  await mkdir(opts.outputDir, { recursive: true });

  const jsonlPath = `${opts.outputDir}/raw-runs.jsonl`;
  const csvPath = `${opts.outputDir}/raw-runs.csv`;
  const summaryPath = `${opts.outputDir}/summary.json`;

  // Truncate any stale JSONL from a previous run so partial-crash semantics
  // are unambiguous: a non-empty file under `outputDir` belongs to THIS run.
  await rm(jsonlPath, { force: true });

  // Build flat task list. Order = scenario → mode → rep so the JSONL append
  // order matches the sequential pre-E2.14 behaviour when `parallelism === 1`.
  interface Task {
    scenario: ScenarioSpec;
    mode: "with-ssa" | "without-ssa";
    rep: number;
  }
  const tasks: Task[] = [];
  for (const scenario of opts.scenarios) {
    for (const mode of modes) {
      for (let rep = 0; rep < opts.repetitions; rep += 1) {
        tasks.push({ scenario, mode, rep });
      }
    }
  }

  // Hoisted console mute (E2.14): per-run save/restore was unsafe under
  // concurrency — overlapping runs could snapshot each other's muted noop
  // as "real" and leak the mute past the experiment boundary. Muting once
  // here is concurrency-safe (single save, single restore in finally).
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  // Progress logging (E2.15). `progressLog` captures `realLog` BEFORE the
  // mute below assigns the noop, so progress lines bypass the harness-wide
  // mute. Counter is incremented as each record resolves; cadence is
  // `logEveryN` (default 1) plus a guaranteed line for the final run.
  const logEveryN = Math.max(1, Math.floor(opts.logEveryN ?? 1));
  const progressLog: (line: string) => void = (line) => { realLog(line); };
  let completed = 0;

  try {
    // Process tasks in chunks of `parallelism`. Within each chunk every task
    // resolves before the next chunk starts (Promise.all barrier), so the
    // JSONL append order is deterministic at chunk boundaries — within a
    // chunk we re-sort by original task index so the on-disk row order is
    // also deterministic across parallelism settings.
    for (let i = 0; i < tasks.length; i += parallelism) {
      const chunk = tasks.slice(i, i + parallelism);
      const results = await Promise.all(
        chunk.map((t) => executeSingleRun(t.scenario, t.mode, t.rep, baseConfig)),
      );
      for (const record of results) {
        records.push(record);
        // Per-record append maximises crash survivability — a Ctrl-C mid-chunk
        // still leaves every completed run on disk.
        await appendFile(jsonlPath, JSON.stringify(record) + "\n");
        completed += 1;
        const isLast = completed === tasks.length;
        if (completed % logEveryN === 0 || isLast) {
          const fitness = record.bestFitness === null
            ? "n/a"
            : record.bestFitness.toFixed(3);
          const duration = Math.round(record.totalDurationMs);
          progressLog(
            `[${record.scenarioId}][${record.mode}]` +
              `[rep ${record.repetitionIndex + 1}/${opts.repetitions}] ` +
              `status=${record.status} fitness=${fitness} duration=${duration}ms`,
          );
        }
      }
    }
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }

  await writeFile(csvPath, recordsToCsv(records));
  await writeFile(summaryPath, JSON.stringify(summarize(records), null, 2));

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

/**
 * Parse `--parallelism N` and `--parallelism=N` from an argv list.
 * Returns `1` if absent or unparseable, mirroring the AblationOpts default.
 * Exported for unit testability; the CLI entry below is the only runtime caller.
 */
export function parseParallelismFlag(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--parallelism" && i + 1 < argv.length) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
    if (a.startsWith("--parallelism=")) {
      const n = Number.parseInt(a.slice("--parallelism=".length), 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return 1;
}

/**
 * Render the dry-run matrix block. Pure — exported for unit testing.
 *
 * Wall-clock estimate uses the backlog's per-run band (5–15s) divided by
 * `parallelism`. The estimate is intentionally a range, not a point, because
 * (a) the seed dataset is small but per-run variance is real (~3×), and (b)
 * the backlog acceptance asks for a "concrete estimate", not a precise one.
 */
export function formatDryRunMatrix(
  scenarios: readonly ScenarioSpec[],
  repetitions: number,
  parallelism: number,
): string {
  const totalRuns = scenarios.length * 2 * repetitions;
  const lowSec = (totalRuns * 5) / parallelism;
  const highSec = (totalRuns * 15) / parallelism;
  const fmt = (sec: number) => sec >= 60 ? `${(sec / 60).toFixed(0)} min` : `${sec.toFixed(0)} s`;
  const ids = scenarios.map((s) => s.id).join(", ");
  return [
    "[ssa-ablation] dry run:",
    `  scenarios: ${scenarios.length} (${ids})`,
    `  modes:     2 (with-ssa, without-ssa)`,
    `  reps:      ${repetitions}`,
    `  total:     ${totalRuns} runs`,
    `  parallel:  ${parallelism}`,
    `  estimate:  ~${fmt(lowSec)}–${fmt(highSec)} wall-clock (at 5–15s/run ÷ ${parallelism} parallel)`,
  ].join("\n");
}

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
    const repetitions = 2;
    const parallelism = parseParallelismFlag(process.argv);
    const dryRun = process.argv.includes("--dry-run");

    if (dryRun) {
      console.log(formatDryRunMatrix([smokeScenario], repetitions, parallelism));
      // Still call the harness so the dry-run code path is exercised end-to-end;
      // it returns immediately without I/O.
      await runAblationExperiment({
        repetitions,
        scenarios: [smokeScenario],
        gaConfigOverrides: { generations: 20, populationSize: 20 },
        outputDir,
        parallelism,
        dryRun: true,
      });
      return;
    }

    console.log(
      `[ssa-ablation] smoke mode — ${repetitions} reps × 2 modes × 1 scenario` +
        (parallelism > 1 ? ` (parallelism=${parallelism})` : ""),
    );
    const report = await runAblationExperiment({
      repetitions,
      scenarios: [smokeScenario],
      gaConfigOverrides: { generations: 20, populationSize: 20 },
      outputDir,
      parallelism,
    });

    // `runAblationExperiment` now writes raw-runs.jsonl, raw-runs.csv, and
    // summary.json into `outputDir` itself (E2.13). No extra smoke-summary
    // file — `summary.json` serves that role.
    console.log(
      `[ssa-ablation] smoke complete — ${report.totalRuns} runs → ${outputDir}/{raw-runs.jsonl,raw-runs.csv,summary.json}`,
    );
  })().catch((err) => {
    console.error("[ssa-ablation] smoke failed:", err);
    process.exitCode = 1;
  });
}
