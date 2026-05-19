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

// Implementation lands in E2.11. Intentionally empty.
export {};
