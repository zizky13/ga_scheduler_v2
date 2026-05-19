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

import {
  borderlineOfferings,
  courseOfferings,
  lecturers,
  rooms,
  structurallyInfeasibleOfferings,
  timeSlots,
} from "../db/seed.js";
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

/**
 * Scenario C — `structurally-infeasible` (the headline scenario).
 *
 * Composition: `[...courseOfferings, ...structurallyInfeasibleOfferings]` —
 * the 15 canonical offerings plus 50 additive LAB sections defined in
 * `src/db/seed.ts`. Every added offering individually satisfies all Pre-GA
 * Layer-1 checks (valid lecturer + competency, LAB-A room with sufficient
 * capacity, LAB facility present, isFixed:false), but their aggregate
 * demand of 65 sessions exceeds the bipartite right-side capacity that
 * SSA's Hopcroft–Karp searches over — the right nodes are distinct
 * block-start slot IDs (not (room, slot) coordinates), so the matching
 * is upper-bounded by the number of usable slot IDs across the week.
 *
 * Empirical verdict (verified during E3.19 authoring):
 *   `runPreGA([...courseOfferings, ...structurallyInfeasibleOfferings])` →
 *     65 feasible, 0 infeasible.
 *   `runSSA(candidates, timeSlots)` →
 *     status='INFEASIBLE', code=BIPARTITE_MATCHING_INSUFFICIENT,
 *     totalSessionsRequired=65, maximumAchievableMatching=37.
 *
 * Why this proves SSA's value (E3.19 acceptance contract):
 *   - `with-ssa` mode: orchestrator short-circuits on SSA's INFEASIBLE
 *     verdict, returns `gaResult === undefined` in milliseconds.
 *   - `without-ssa` mode: GA runs the full loop on a hopeless input,
 *     producing either `hardViolations > 0` (no real schedule exists) or
 *     `stagnatedEarly === true` (cannot improve past a local optimum).
 *
 * Note: the original task 19 premise (use `infeasibleOfferings`) was
 * empirically incorrect — Pre-GA rejects all four entries before SSA
 * runs, so SSA only ever sees 15 feasible candidates and returns
 * FEASIBLE. The structurally-infeasible scenario must therefore be
 * constructed from offerings that pass Pre-GA individually but
 * collectively over-subscribe SSA's matching capacity.
 */
export const structurallyInfeasibleScenario: ScenarioSpec = {
  id: "structurally-infeasible",
  label:
    "Scenario C — structurally-infeasible (65 sessions vs ~37 matchable, SSA must detect)",
  build: () => ({
    offerings: [...courseOfferings, ...structurallyInfeasibleOfferings],
    timeSlots,
    rooms,
    lecturers,
  }),
};

/**
 * Scenario D — `borderline-ac3-prunes` (AC-3 stress, SSA helps but doesn't
 * declare infeasibility).
 *
 * Composition: `[...courseOfferings, ...borderlineOfferings]` — the 15
 * canonical offerings plus 7 additive borderline entries defined in
 * `src/db/seed.ts` (4 fixed + 3 flexible). The point of this scenario is
 * to exercise the middle band of SSA's behaviour: Phase 0 (Static
 * Exclusion) locks a non-trivial number of (room, slot) coordinates and
 * AC-3 prunes the flexible offerings' domains significantly, yet Phase 2
 * (Hopcroft-Karp) still finds a maximum matching — so the SSA verdict is
 * FEASIBLE, not INFEASIBLE.
 *
 * Why this matters for the ablation report:
 *   With-SSA mode hands the GA a pre-pruned candidate set (domains already
 *   stripped of structurally impossible (room, slot) coordinates). Without
 *   SSA, the GA's initial population samples from the full unpruned domain
 *   and burns generations rediscovering those exclusions via the fitness
 *   penalty. This is the scenario where SSA's domain pruning should
 *   manifest as faster convergence / earlier `firstFeasibleGeneration` /
 *   higher success rate, without the binary short-circuit signal scenario
 *   C provides.
 *
 * Empirical SSA verdict on the composed input (verified by the companion
 * test `tests/experiments/scenarios.borderline-ac3.test.ts`):
 *   `runStaticExclusion(...).lockedCoordinates.size === 17`
 *     (6 from existing fixed offerings 6 & 15 + 11 from the four new
 *     borderline fixed offerings 300–303).
 *   `runSSA(candidates, timeSlots).status === 'FEASIBLE'`.
 */
export const borderlineScenario: ScenarioSpec = {
  id: "borderline-ac3-prunes",
  label:
    "Scenario D — borderline-ac3-prunes (Phase 0 + AC-3 prune meaningfully, Phase 2 still finds matching)",
  build: () => ({
    offerings: [...courseOfferings, ...borderlineOfferings],
    timeSlots,
    rooms,
    lecturers,
  }),
};

/**
 * Manifest of every scenario the ablation harness should sweep.
 *
 * Order matters for report readability — scenarios are listed by increasing
 * SSA-pressure so a reader of `summary.json` / `raw-runs.csv` can read down
 * the rows and see the story unfold:
 *
 *   1. `feasible-easy`            — baseline; SSA bypass is a no-op.
 *   2. `feasible-tight`           — 4-room constraint pressure; SSA still
 *                                   feasible, GA must work harder without it.
 *   3. `borderline-ac3-prunes`    — Phase 0 + AC-3 prune meaningfully; SSA
 *                                   FEASIBLE but domain pruning should
 *                                   accelerate GA convergence.
 *   4. `structurally-infeasible`  — headline scenario; SSA returns INFEASIBLE
 *                                   and short-circuits, while bypass mode
 *                                   wastes the full GA loop.
 *
 * Each member's full rationale lives in the JSDoc above its export. The
 * harness imports this manifest as its default scenario set — see
 * `src/experiments/ssa-ablation.ts`'s CLI entry.
 */
export const ALL_SCENARIOS: ScenarioSpec[] = [
  feasibleEasyScenario,
  feasibleTightScenario,
  borderlineScenario,
  structurallyInfeasibleScenario,
];
