import { describe, it, expect } from "vitest";
import { feasibleEasyScenario } from "../../src/experiments/scenarios.js";
import { runPipeline } from "../../src/orchestrator.js";
import type { GAConfig } from "../../src/types.js";

/**
 * E3.17 acceptance check.
 *
 * Verifies that scenario A (`feasible-easy`) — the canonical seed reused
 * verbatim — runs through `runPipeline` with `skipSSA: false` and produces
 * `status === 'SUCCESS'` with `hardViolations === 0`. This is the "GA
 * performs fine, SSA bypass is a no-op" baseline the report relies on.
 *
 * Pipeline noise is muted for the duration of the test (mirrors the harness
 * convention in `src/experiments/ssa-ablation.ts`) so vitest output stays
 * focused on the assertion result.
 */
describe("scenarios.feasibleEasyScenario", () => {
  it("returns a valid OrchestratorInput shape from build()", () => {
    const built = feasibleEasyScenario.build();
    expect(feasibleEasyScenario.id).toBe("feasible-easy");
    expect(built.offerings.length).toBeGreaterThan(0);
    expect(built.timeSlots.length).toBeGreaterThan(0);
    expect(built.rooms.length).toBeGreaterThan(0);
    expect(built.lecturers.length).toBeGreaterThan(0);
  });

  it(
    "runs through runPipeline with skipSSA: false → SUCCESS, hardViolations === 0",
    { timeout: 30_000 },
    async () => {
      const built = feasibleEasyScenario.build();

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
        const out = await runPipeline({
          offerings: built.offerings,
          timeSlots: built.timeSlots,
          rooms: built.rooms,
          lecturers: built.lecturers,
          config,
        });
        const response = out.response;

        expect(response.status).toBe("SUCCESS");
        expect(response.gaResult?.hardViolations).toBe(0);
      } finally {
        console.log = realLog;
        console.warn = realWarn;
      }
    },
  );
});
