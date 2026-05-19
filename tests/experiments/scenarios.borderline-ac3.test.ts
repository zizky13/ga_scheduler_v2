import { describe, it, expect } from "vitest";
import { borderlineScenario } from "../../src/experiments/scenarios.js";
import { courseOfferings } from "../../src/db/seed.js";
import { runPreGA } from "../../src/pre-ga/validator.js";
import { runSSA } from "../../src/ssa/index.js";
import { runStaticExclusion } from "../../src/ssa/staticExclusion.js";

/**
 * E3.20 acceptance check — Scenario D (`borderline-ac3-prunes`).
 *
 * Acceptance contract:
 *   1. `runStaticExclusion(candidates).lockedCoordinates.size ≥ 4`
 *      → Phase 0 locks a non-trivial number of (room, slot) coordinates so
 *        AC-3 has something to propagate.
 *   2. `runSSA(candidates, timeSlots).status === 'FEASIBLE'`
 *      → Phase 2 still finds a maximum matching despite the domain pruning.
 *   3. The canonical `courseOfferings` export is unchanged (length 15) —
 *        proves the additive change in `src/db/seed.ts` did not mutate the
 *        existing CLI runner inputs.
 */
describe("scenarios.borderlineScenario", () => {
  it("returns a valid OrchestratorInput shape from build() with 22 offerings", () => {
    const built = borderlineScenario.build();
    expect(borderlineScenario.id).toBe("borderline-ac3-prunes");
    // 15 canonical + 7 borderline (4 fixed + 3 flexible) = 22.
    expect(built.offerings.length).toBe(22);
    expect(built.rooms.length).toBe(6);
    expect(built.timeSlots.length).toBe(55);
    expect(built.lecturers.length).toBe(8);
  });

  it("Phase 0 (Static Exclusion) locks at least 4 (room, slot) coordinates", () => {
    const built = borderlineScenario.build();
    const { validation, candidates } = runPreGA(
      built.offerings,
      built.timeSlots,
      built.rooms,
    );
    // All 22 must pass Pre-GA — none of the borderline offerings has any
    // structural defect (valid lecturer + competency, capacity OK, facility
    // match for the LAB-pinned entry).
    expect(validation.infeasible.length).toBe(0);
    expect(candidates.length).toBe(22);

    const exclusion = runStaticExclusion(candidates);
    expect(
      exclusion.lockedCoordinates.size,
      `expected lockedCoordinates.size >= 4, got ${exclusion.lockedCoordinates.size}`,
    ).toBeGreaterThanOrEqual(4);
  });

  it("SSA returns FEASIBLE on the composed input (Phase 2 finds maximum matching)", () => {
    const built = borderlineScenario.build();
    const { candidates } = runPreGA(
      built.offerings,
      built.timeSlots,
      built.rooms,
    );
    const ssaResult = runSSA(candidates, built.timeSlots);
    expect(
      ssaResult.status,
      `expected FEASIBLE, got ${ssaResult.status} (deadlock=${
        ssaResult.deadlockReport?.code ?? "n/a"
      })`,
    ).toBe("FEASIBLE");
    expect(ssaResult.maximumAchievableMatching).toBe(
      ssaResult.totalSessionsRequired,
    );
  });

  it("canonical courseOfferings export is unchanged (additive-only scope)", () => {
    expect(courseOfferings.length).toBe(15);
  });
});
