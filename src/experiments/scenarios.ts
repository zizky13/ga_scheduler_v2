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

/**
 * Scenario B — `feasible-tight` (constraint pressure).
 *
 * Same 15 seed offerings and 60-slot grid as scenario A, but the room set is
 * pruned from 6 rooms down to 4. Specifically we drop:
 *   - `LAB-B` (id 5) — one of the two LAB rooms
 *   - `R-102`  (id 2) — one of the three general (PROJECTOR-only) rooms
 *
 * What this preserves (and why it stays SSA-feasible):
 *   - `R-201` (id 3) is kept because offerings 6 and 15 are FIXED to room 3
 *     with specific contiguous slots (Mon 07:30–10:00 and Tue 07:30–10:00).
 *     Dropping R-201 would make those fixed assignments impossible and SSA
 *     Phase 0 (Static Exclusion) would report `INFEASIBLE`.
 *   - `LAB-A` (id 4) is kept because all five LAB-tagged offerings (1, 2, 3,
 *     13, 14) require a `LAB` facility; removing both LAB rooms would make
 *     Pre-GA reject those offerings outright. With LAB-B gone, the five LAB
 *     offerings (3 sks each = 15 contiguous slot-blocks) must share LAB-A's
 *     60 slots, which is the central source of constraint pressure.
 *   - `Studio-1` (id 6) is kept because offering 9 (Desain Visual) requires
 *     the `STUDIO` facility; it is the only studio in the seed.
 *   - Two general rooms (`R-101`, `R-201`) remain to host the four
 *     non-LAB/non-studio flexible offerings (5, 7, 8, 10, 11, 12), but R-201
 *     loses 6 slots upfront to the two fixed offerings, so contention is
 *     real.
 *
 * Why we don't trim the timeslot grid:
 *   The backlog allows reducing rooms *and/or* trimming slots. The seed's
 *   fixed offerings hard-code specific slot IDs (`[1,2,3]` and `[12,13,14]`),
 *   and a naive "keep slots 1–30" prune is fine for those, but any other cut
 *   risks structural infeasibility. To keep the scenario robust under future
 *   seed edits we apply room reduction only and let the LAB-A bottleneck +
 *   R-201 fixed locks supply the pressure.
 *
 * Acceptance contract (task E3.18):
 *   - SSA returns `FEASIBLE` (verified by `scenarios.feasible-tight.test.ts`).
 *   - GA in `with-SSA` mode reaches `hardViolations === 0` within
 *     `generations: 300` in at least 80% of 10 runs (also verified by the
 *     accompanying test).
 */
export const feasibleTightScenario: ScenarioSpec = {
  id: "feasible-tight",
  label: "Scenario B — feasible-tight (4 rooms, constraint pressure)",
  build: () => ({
    offerings: courseOfferings,
    timeSlots,
    // Drop LAB-B (id 5) and R-102 (id 2). Keep LAB-A, R-101, R-201, Studio-1.
    rooms: rooms.filter((r) => r.id !== 5 && r.id !== 2),
    lecturers,
  }),
};

// NOTE: `ALL_SCENARIOS` and scenarios C/D land in tasks E3.19–E3.21.
