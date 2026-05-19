import { describe, it, expect } from "vitest";
import { feasibleTightScenario } from "../../src/experiments/scenarios.js";
import { runPipeline } from "../../src/orchestrator.js";
import { runPreGA } from "../../src/pre-ga/validator.js";
import { runSSA } from "../../src/ssa/index.js";
import type { GAConfig } from "../../src/types.js";

/**
 * E3.18 acceptance check — Scenario B (`feasible-tight`).
 *
 * Two assertions, mirroring the backlog acceptance criteria:
 *   1. SSA returns `FEASIBLE` for the reduced (4-room) input. The scenario
 *      drops LAB-B and R-102 from the canonical seed; the JSDoc on
 *      `feasibleTightScenario` explains why the remaining four rooms still
 *      satisfy Pre-GA + SSA (LAB-A, R-101, R-201, Studio-1).
 *   2. Running `runPipeline` with `skipSSA: false` and `generations: 300`
 *      produces `gaResult.hardViolations === 0` in at least 8 of 10 attempts.
 *
 * Pipeline noise is muted for the duration of each run because `runGA` emits
 * per-generation progress logs that drown out vitest output.
 */
describe("scenarios.feasibleTightScenario", () => {
  it("returns a valid OrchestratorInput shape from build() with 4 rooms", () => {
    const built = feasibleTightScenario.build();
    expect(feasibleTightScenario.id).toBe("feasible-tight");
    expect(built.offerings.length).toBe(15);
    expect(built.rooms.length).toBe(4);
    // Sanity: the kept rooms are LAB-A, R-101, R-201, Studio-1.
    const keptIds = new Set(built.rooms.map((r) => r.id));
    expect(keptIds.has(1)).toBe(true); // R-101
    expect(keptIds.has(3)).toBe(true); // R-201 (required by fixed offerings 6, 15)
    expect(keptIds.has(4)).toBe(true); // LAB-A (only LAB room left)
    expect(keptIds.has(6)).toBe(true); // Studio-1 (only studio)
    expect(keptIds.has(2)).toBe(false); // R-102 dropped
    expect(keptIds.has(5)).toBe(false); // LAB-B dropped
  });

  it("SSA returns FEASIBLE on the reduced room set", () => {
    const built = feasibleTightScenario.build();
    const { candidates } = runPreGA(
      built.offerings,
      built.timeSlots,
      built.rooms,
    );
    expect(candidates.length).toBeGreaterThan(0);
    const ssaResult = runSSA(candidates, built.timeSlots);
    expect(ssaResult.status).toBe("FEASIBLE");
  });

  it(
    "GA reaches hardViolations === 0 in ≥80% of 10 runs with skipSSA: false, generations: 300",
    { timeout: 180_000 },
    async () => {
      const built = feasibleTightScenario.build();

      const config: GAConfig = {
        populationSize: 60,
        generations: 300,
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

      let successes = 0;
      const RUNS = 10;
      try {
        for (let i = 0; i < RUNS; i++) {
          const out = await runPipeline({
            offerings: built.offerings,
            timeSlots: built.timeSlots,
            rooms: built.rooms,
            lecturers: built.lecturers,
            config,
          });
          if (
            out.response.status === "SUCCESS" &&
            out.response.gaResult?.hardViolations === 0
          ) {
            successes++;
          }
        }
      } finally {
        console.log = realLog;
        console.warn = realWarn;
      }

      // Report visible in vitest output: how many of 10 succeeded.
      // eslint-disable-next-line no-console
      console.log(`[feasible-tight] successes: ${successes}/${RUNS}`);
      expect(successes).toBeGreaterThanOrEqual(8);
    },
  );
});
