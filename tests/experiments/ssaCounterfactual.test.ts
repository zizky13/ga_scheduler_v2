/**
 * computeSsaCounterfactual — harness-side telemetry helper (E1 task 9).
 *
 * Verifies the helper produces the two acceptance fields the ablation report
 * needs (`wouldHavePrunedCoordinates`, `wouldHaveDeclaredInfeasible`) without
 * mutating its inputs, and that the static-exclusion count matches the seed's
 * fixed-room coordinate footprint exactly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runPreGA } from "../../src/pre-ga/validator.js";
import {
  rooms,
  timeSlots,
  courseOfferings,
  infeasibleOfferings,
} from "../../src/db/seed.js";
import { computeSsaCounterfactual } from "../../src/experiments/ssa-ablation.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeSsaCounterfactual", () => {
  it("pure: input arrays are not mutated", () => {
    const { candidates } = runPreGA(courseOfferings, timeSlots, rooms);

    const candidatesCopy = [...candidates];
    const slotsCopy = [...timeSlots];
    const lengthsBefore = candidates.map((c) => c.possibleTimeSlotIds.length);
    const candidatesLengthBefore = candidates.length;
    const slotsLengthBefore = timeSlots.length;

    computeSsaCounterfactual(candidatesCopy, slotsCopy);

    expect(candidates.length).toBe(candidatesLengthBefore);
    expect(timeSlots.length).toBe(slotsLengthBefore);
    candidates.forEach((c, i) => {
      expect(c.possibleTimeSlotIds.length).toBe(lengthsBefore[i]);
    });
    // The helper-local copies should also be untouched (helper spreads internally).
    expect(candidatesCopy.length).toBe(candidatesLengthBefore);
    expect(slotsCopy.length).toBe(slotsLengthBefore);
  });

  it("feasible seed: wouldHaveDeclaredInfeasible is false", () => {
    const { candidates } = runPreGA(courseOfferings, timeSlots, rooms);

    const result = computeSsaCounterfactual(candidates, timeSlots);

    expect(result.wouldHaveDeclaredInfeasible).toBe(false);
    expect(typeof result.wouldHavePrunedCoordinates).toBe("number");
    expect(result.wouldHavePrunedCoordinates).toBeGreaterThanOrEqual(0);
  });

  it("starved-slot grid: wouldHaveDeclaredInfeasible is true", () => {
    // Mirrors the slot-starvation trick from tests/orchestrator/skipSSA.test.ts:
    // a 15-slot grid combined with the infeasible-offerings fixture overflows
    // the bipartite matching and forces an INFEASIBLE verdict.
    const starvedTimeSlots = timeSlots.slice(0, 15);
    const offerings = [...courseOfferings, ...infeasibleOfferings];
    const { candidates } = runPreGA(offerings, starvedTimeSlots, rooms);

    const result = computeSsaCounterfactual(candidates, starvedTimeSlots);

    expect(result.wouldHaveDeclaredInfeasible).toBe(true);
  });

  it("wouldHavePrunedCoordinates is non-negative and reflects fixed candidates", () => {
    const { candidates } = runPreGA(courseOfferings, timeSlots, rooms);

    // runStaticExclusion locks one (roomId, slotId) coordinate per
    // possibleTimeSlotId on every fixed-room candidate (see
    // src/ssa/staticExclusion.ts:27-31). Since each fixed candidate has a
    // single roomId, that count equals the sum of possibleTimeSlotIds.length
    // across fixed candidates (no cross-candidate de-duplication can shrink
    // it because fixed pinnings target distinct rooms or distinct slots).
    const expectedPruned = candidates
      .filter((c) => c.isFixedRoom)
      .reduce((sum, c) => sum + c.possibleTimeSlotIds.length, 0);

    const result = computeSsaCounterfactual(candidates, timeSlots);

    expect(result.wouldHavePrunedCoordinates).toBeGreaterThanOrEqual(0);
    expect(result.wouldHavePrunedCoordinates).toBe(expectedPruned);
  });
});
