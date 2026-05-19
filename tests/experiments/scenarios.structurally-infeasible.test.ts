import { describe, it, expect } from "vitest";
import { structurallyInfeasibleScenario } from "../../src/experiments/scenarios.js";
import { runPipeline } from "../../src/orchestrator.js";
import { runPreGA } from "../../src/pre-ga/validator.js";
import { runSSA } from "../../src/ssa/index.js";
import type { GAConfig } from "../../src/types.js";

/**
 * E3.19 acceptance check — Scenario C (`structurally-infeasible`).
 *
 * Two scenarios mirror the backlog acceptance criteria:
 *   1. `with-SSA` mode: SSA must detect the over-subscription and the
 *      orchestrator must short-circuit before the GA runs — i.e.
 *      `status === 'INFEASIBLE'`, `gaResult === undefined`, fast duration.
 *   2. `without-SSA` mode: GA runs the full loop on the hopeless input and
 *      returns either `status === 'SUCCESS'` with `hardViolations > 0` OR
 *      `gaResult.stagnatedEarly === true`.
 *
 * The scenario composes `[...courseOfferings, ...structurallyInfeasibleOfferings]`
 * (65 offerings total). All 65 pass Pre-GA Layer-1 checks individually; SSA's
 * Hopcroft–Karp reports `INFEASIBLE` because the bipartite right side is
 * keyed by slot IDs (not (room, slot) coordinates), so 65 required sessions
 * exceed the ~37 distinct block-start slots available.
 *
 * Pipeline noise is muted for the duration of each pipeline call because
 * `runGA` emits per-generation progress logs.
 */
describe("scenarios.structurallyInfeasibleScenario", () => {
  it("returns a valid OrchestratorInput shape from build() with 65 offerings", () => {
    const built = structurallyInfeasibleScenario.build();
    expect(structurallyInfeasibleScenario.id).toBe("structurally-infeasible");
    expect(built.offerings.length).toBe(65);
    expect(built.rooms.length).toBe(6);
    expect(built.timeSlots.length).toBe(55);
    expect(built.lecturers.length).toBe(8);
  });

  it("SSA returns INFEASIBLE with BIPARTITE_MATCHING_INSUFFICIENT", () => {
    const built = structurallyInfeasibleScenario.build();
    const { validation, candidates } = runPreGA(
      built.offerings,
      built.timeSlots,
      built.rooms,
    );
    // All 65 must pass Pre-GA — the construction is "individually valid,
    // collectively over-subscribed".
    expect(validation.infeasible.length).toBe(0);
    expect(candidates.length).toBe(65);

    const ssaResult = runSSA(candidates, built.timeSlots);
    expect(ssaResult.status).toBe("INFEASIBLE");
    expect(ssaResult.totalSessionsRequired).toBe(65);
    expect(ssaResult.maximumAchievableMatching).toBeLessThan(
      ssaResult.totalSessionsRequired,
    );
    expect(ssaResult.deadlockReport?.code).toBe(
      "BIPARTITE_MATCHING_INSUFFICIENT",
    );
  });

  it(
    "with-SSA: orchestrator short-circuits with status INFEASIBLE and no gaResult",
    { timeout: 30_000 },
    async () => {
      const built = structurallyInfeasibleScenario.build();

      const config: GAConfig = {
        populationSize: 40,
        generations: 100,
        mutationRate: 0.1,
        elitismCount: 3,
        tournamentSize: 4,
        crossoverType: "singlePoint",
        noiseRate: 0.15,
        hardPenaltyWeight: 100,
        softPenaltyWeight: 1,
        skipSSA: false,
      };

      const realLog = console.log;
      const realWarn = console.warn;
      console.log = () => {};
      console.warn = () => {};

      try {
        const start = performance.now();
        const out = await runPipeline({
          offerings: built.offerings,
          timeSlots: built.timeSlots,
          rooms: built.rooms,
          lecturers: built.lecturers,
          config,
        });
        const elapsed = performance.now() - start;

        expect(out.response.status).toBe("INFEASIBLE");
        expect(out.response.gaResult).toBeUndefined();
        // Generous upper bound — should finish in well under 5 s since no GA
        // generations execute.
        expect(elapsed).toBeLessThan(5_000);
      } finally {
        console.log = realLog;
        console.warn = realWarn;
      }
    },
  );

  it(
    "without-SSA: GA runs to completion and reports hardViolations > 0 or stagnatedEarly",
    { timeout: 120_000 },
    async () => {
      const built = structurallyInfeasibleScenario.build();

      const config: GAConfig = {
        populationSize: 40,
        generations: 80,
        mutationRate: 0.1,
        elitismCount: 3,
        tournamentSize: 4,
        crossoverType: "singlePoint",
        noiseRate: 0.15,
        hardPenaltyWeight: 100,
        softPenaltyWeight: 1,
        skipSSA: true,
      };

      const realLog = console.log;
      const realWarn = console.warn;
      console.log = () => {};
      console.warn = () => {};

      try {
        const out = await runPipeline({
          offerings: built.offerings,
          timeSlots: built.timeSlots,
          rooms: built.rooms,
          lecturers: built.lecturers,
          config,
        });
        const response = out.response;

        // Must reach SUCCESS (GA actually ran to its terminal state — even
        // failed-to-find-feasible is reported as SUCCESS by the pipeline).
        expect(response.status).toBe("SUCCESS");
        expect(response.ssaSkipped).toBe(true);
        expect(response.gaResult).toBeDefined();
        const ga = response.gaResult!;

        // Either GA could not find a real schedule (hardViolations > 0) OR
        // it stagnated early — both prove SSA's value on this input.
        const failedToFindFeasible =
          (ga.hardViolations ?? 0) > 0 || ga.stagnatedEarly === true;
        expect(failedToFindFeasible).toBe(true);
      } finally {
        console.log = realLog;
        console.warn = realWarn;
      }
    },
  );
});
