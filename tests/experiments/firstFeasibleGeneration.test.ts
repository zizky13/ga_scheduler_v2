import { describe, it, expect } from "vitest";
import { firstFeasibleGeneration } from "../../src/experiments/ssa-ablation.js";
import type { GenerationSnapshot } from "../../src/ga/runGA.js";

function buildSnapshot(overrides: Partial<GenerationSnapshot>): GenerationSnapshot {
  return {
    generation: 1,
    bestFitness: 0,
    avgFitness: 0,
    hardViolations: 0,
    softPenalty: 0,
    competencyMismatch: 0,
    structuralPenalty: 0,
    preferencePenalty: 0,
    ...overrides,
  };
}

describe("firstFeasibleGeneration", () => {
  it("returns null on empty input", () => {
    expect(firstFeasibleGeneration([])).toBeNull();
  });

  it("returns null when no snapshot reaches feasibility", () => {
    const snapshots = [
      buildSnapshot({ generation: 1, hardViolations: 7 }),
      buildSnapshot({ generation: 2, hardViolations: 4 }),
      buildSnapshot({ generation: 3, hardViolations: 2 }),
    ];
    expect(firstFeasibleGeneration(snapshots)).toBeNull();
  });

  it("returns the generation number of the first feasible snapshot", () => {
    const snapshots = [
      buildSnapshot({ generation: 1, hardViolations: 5 }),
      buildSnapshot({ generation: 2, hardViolations: 3 }),
      buildSnapshot({ generation: 3, hardViolations: 0 }),
      buildSnapshot({ generation: 4, hardViolations: 0 }),
    ];
    expect(firstFeasibleGeneration(snapshots)).toBe(3);
  });

  it("treats hardViolations === 0 as the bar, not fitness", () => {
    const snapshots = [
      buildSnapshot({ generation: 1, bestFitness: 0.95, hardViolations: 2 }),
      buildSnapshot({ generation: 2, bestFitness: 0.1, hardViolations: 0 }),
    ];
    expect(firstFeasibleGeneration(snapshots)).toBe(2);
  });
});
