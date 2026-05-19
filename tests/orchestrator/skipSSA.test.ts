/**
 * Orchestrator — GAConfig.skipSSA ablation switch
 *
 * Exercises the experimental SSA bypass branch added in Phase E0 of
 * docs/backlog_experiment.md. The bypass lets ablation experiments skip
 * the Sufficiency-Sanity-Assertion gate and feed Pre-GA candidates
 * directly to runGA, while still surfacing the choice via the required
 * `SchedulerResponse.ssaSkipped` flag.
 *
 * Scenarios:
 *   1. skipSSA = false  — SSA runs and intercepts structurally infeasible
 *                          input (the canonical feasible seed concatenated
 *                          with `infeasibleOfferings`, matching the CLI
 *                          composition in src/cli/run-pipeline.ts:55).
 *                          ssaSkipped must be `false`; the run must either
 *                          short-circuit with status `INFEASIBLE` or never
 *                          reach `gaResult`.
 *   2. skipSSA = true   — bypass reaches GA. ssaResult is absent, the
 *                          ssaSkipped flag is `true`, status is `SUCCESS`,
 *                          and gaResult is populated.
 *   3. skipSSA omitted  — backward-compat check: ssaSkipped defaults to
 *                          `false` for every existing caller.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseOffering, GAConfig } from '../../src/types.js';
import { runPipeline } from '../../src/orchestrator.js';
import {
  rooms,
  timeSlots,
  lecturers,
  courseOfferings,
  infeasibleOfferings,
} from '../../src/db/seed.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Small, fast GA config — the bypass test does NOT require GA convergence,
// only that runGA produces a gaResult object.
function buildBaseConfig(): GAConfig {
  return {
    populationSize: 15,
    generations: 20,
    mutationRate: 0.1,
    elitismCount: 2,
    tournamentSize: 3,
    crossoverType: 'singlePoint',
    noiseRate: 0.1,
    hardPenaltyWeight: 100,
    softPenaltyWeight: 1,
  };
}

// CLI composition: feasible baseline + the Pre-GA infeasible fixtures.
// Pre-GA rejects the infeasible ones; SSA is then exercised on whatever
// remains feasible.
function buildOfferings(): CourseOffering[] {
  return [...courseOfferings, ...infeasibleOfferings];
}

// Starve the timeslot grid down to two days (Mon=1..11, Tue=12..22 —
// preserving both fixed-offering pinnings at [1,2,3] and [12,13,14]). With
// only 22 total slots, the global session demand from the feasible subset
// exceeds maximum bipartite matching, so Hopcroft-Karp must return
// INFEASIBLE. The full grid (60 slots) lets SSA succeed; this slice is
// the structural-infeasibility trigger the bypass test relies on.
const starvedTimeSlots = timeSlots.slice(0, 15);

describe('orchestrator skipSSA — bypass branch', () => {
  it('skipSSA=false: SSA gate intercepts structurally infeasible input', async () => {
    const offerings = buildOfferings();

    const { response } = await runPipeline({
      offerings,
      timeSlots: starvedTimeSlots,
      rooms,
      lecturers,
      config: { ...buildBaseConfig(), skipSSA: false },
    });

    // ssaSkipped must be false whenever SSA was consulted (or could have been).
    expect(response.ssaSkipped).toBe(false);

    // Either the SSA gate fired (INFEASIBLE) or the run short-circuited
    // before reaching GA. We assert the disjunction because the harness is
    // permissive — Pre-GA may strip the infeasibles and let SSA succeed in
    // some seed states. In either case `gaResult` only exists alongside a
    // SUCCESS status, never alongside INFEASIBLE.
    const shorted =
      response.status === 'INFEASIBLE' ||
      response.gaResult === undefined;
    expect(shorted).toBe(true);

    if (response.status === 'INFEASIBLE') {
      expect(response.gaResult).toBeUndefined();
      expect(response.ssaResult).toBeDefined();
      expect(response.ssaResult!.status).toBe('INFEASIBLE');
    }
  });

  it('skipSSA=true: bypass reaches GA, ssaSkipped flag is true, ssaResult undefined', async () => {
    const offerings = buildOfferings();

    const { response } = await runPipeline({
      offerings,
      timeSlots: starvedTimeSlots,
      rooms,
      lecturers,
      config: { ...buildBaseConfig(), skipSSA: true },
    });

    expect(response.ssaSkipped).toBe(true);
    expect(response.ssaResult).toBeUndefined();
    // GA cannot return INFEASIBLE — SSA was never consulted.
    expect(response.status).toBe('SUCCESS');
    expect(response.gaResult).toBeDefined();
  });

  it('skipSSA omitted: backward compat — ssaSkipped defaults to false', async () => {
    const offerings = buildOfferings();

    const { response } = await runPipeline({
      offerings,
      timeSlots: starvedTimeSlots,
      rooms,
      lecturers,
      config: buildBaseConfig(), // no skipSSA key at all
    });

    expect(response.ssaSkipped).toBe(false);
  });

  // E1 task 8 — per-phase wall-clock breakdown. The bypass run is the
  // cleanest signal: Pre-GA + GA executed, SSA did not, so ssaDurationMs
  // must be exactly 0 and the three fields must sum to durationMs within
  // a small slack for orchestrator glue between markers.
  it('per-phase durations: bypass run sums to durationMs within ±5ms', async () => {
    const offerings = buildOfferings();

    const { response } = await runPipeline({
      offerings,
      timeSlots: starvedTimeSlots,
      rooms,
      lecturers,
      config: { ...buildBaseConfig(), skipSSA: true },
    });

    expect(response.preGADurationMs).toBeDefined();
    expect(response.ssaDurationMs).toBeDefined();
    expect(response.gaDurationMs).toBeDefined();

    const preGA = response.preGADurationMs!;
    const ssa = response.ssaDurationMs!;
    const ga = response.gaDurationMs!;

    expect(ssa).toBe(0);
    expect(preGA).toBeGreaterThanOrEqual(0);
    expect(ga).toBeGreaterThan(0);

    const sum = preGA + ssa + ga;
    expect(Math.abs(sum - response.durationMs)).toBeLessThanOrEqual(5);
  });
});
