/**
 * SSA Ablation — scenario manifest (Phase E3).
 *
 * Each export here is a `ScenarioSpec` (shape defined in `./ssa-ablation.ts`)
 * the harness sweeps `{with-ssa, without-ssa} × repetitions` times. Scenarios
 * are deliberately small, named compositions of seed inputs; the goal is to
 * cover the matrix of "GA can solve / SSA helps / SSA is critical" so the
 * report can quantify SSA's contribution.
 *
 * The full manifest array `ALL_SCENARIOS` is assembled in task E3.21 once all
 * four scenarios (A–D) have landed. Until then, only the individual exports
 * are stable.
 */

import { courseOfferings, lecturers, rooms, timeSlots } from "../db/seed.js";
import type { ScenarioSpec } from "./ssa-ablation.js";

/**
 * Scenario A — `feasible-easy` (baseline).
 *
 * Uses the canonical seed (`src/db/seed.ts`) verbatim. Phase 0 validated this
 * dataset converges with no hard violations, so it establishes the
 * "GA performs fine, SSA bypass is a no-op" baseline: both `with-ssa` and
 * `without-ssa` modes are expected to succeed, and the SSA counterfactual
 * should prune zero coordinates.
 */
export const feasibleEasyScenario: ScenarioSpec = {
  id: "feasible-easy",
  label: "Scenario A — feasible-easy (canonical seed, baseline)",
  build: () => ({
    offerings: courseOfferings,
    timeSlots,
    rooms,
    lecturers,
  }),
};

// NOTE: `ALL_SCENARIOS` and scenarios B/C/D land in tasks E3.18–E3.21.
