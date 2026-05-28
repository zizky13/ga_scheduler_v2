/**
 * Layer 3 (Hybrid GA) integration tests — techspec §10.1.
 *
 * Backlog Phase 0 / Task 9: Add Layer 3 integration tests covering
 *   1. Easy-dataset convergence    — runPreGA → runSSA → runGA reaches
 *      hardViolations === 0 within the configured generation budget.
 *   2. Stagnation exit             — runGA terminates early when best
 *      fitness fails to improve for STAGNATION_WINDOW (=100) generations
 *      and hardViolations remain > 0.
 *   3. Fixed Room invariant        — every offering tagged isFixedRoom
 *      retains its kind='FIXED' discriminant and original roomId across
 *      every generation of the GA loop, not just at the final output.
 *   4. Elitism monotonicity        — gaResult.history[i+1] >= history[i]
 *      for all i (the best chromosome from generation g survives into
 *      generation g+1 unchanged because elitismCount >= 1).
 *
 * These exercise the real pipeline components — runPreGA, runSSA, runGA —
 * with no mocks. The Fixed Room invariant test additionally drives an
 * explicit per-generation loop using the same crossover / mutation /
 * repair operators runGA uses, so the invariant can be asserted on every
 * intermediate population.
 *
 * Note: Math.random() is not seeded; tests below either run a deterministic
 * loop (Fixed Room invariant) or use small datasets / loose budgets so
 * that flakiness from random search is structurally avoided.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Chromosome,
  CourseOffering,
  GAConfig,
  Gene,
  Lecturer,
  LockedRoom,
  PreGACandidate,
  Room,
  TimeSlot,
} from '../../src/types.js';
import { runPreGA } from '../../src/pre-ga/validator.js';
import { runPipeline } from '../../src/orchestrator.js';
import { runSSA } from '../../src/ssa/index.js';
import { runGA } from '../../src/ga/runGA.js';
import { evaluateFitness } from '../../src/ga/fitness.js';
import { generateInitialPopulation } from '../../src/ga/population.js';
import { tournamentSelection } from '../../src/ga/selection.js';
import { getCrossoverFn } from '../../src/ga/crossover.js';
import { mutateChromosome } from '../../src/ga/mutation.js';
import { repairChromosome } from '../../src/ga/repair.js';
import {
  rooms as seedRooms,
  timeSlots as seedTimeSlots,
  lecturers as seedLecturers,
  courseOfferings as seedCourseOfferings,
} from '../../src/db/seed.js';

// ─── Console suppression ─────────────────────────────────────────
// runGA logs progress every 10 generations; silence it for tests.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Easy-dataset fixture builder ────────────────────────────────
// 5 offerings × 5 lecturers × 5 rooms × 15 slots — ample room/slot supply
// so that the GA reliably converges to hardViolations = 0.
function buildEasyDataset(): {
  rooms: Room[];
  timeSlots: TimeSlot[];
  lecturers: Lecturer[];
  offerings: CourseOffering[];
} {
  const rooms: Room[] = [
    { id: 1, name: 'R-101', capacity: 40, facilities: [] },
    { id: 2, name: 'R-102', capacity: 40, facilities: [] },
    { id: 3, name: 'R-103', capacity: 40, facilities: [] },
    { id: 4, name: 'R-104', capacity: 40, facilities: [] },
    { id: 5, name: 'R-105', capacity: 40, facilities: [] },
  ];

  const timeSlots: TimeSlot[] = [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const times = [
    { start: '08:00', end: '10:00' },
    { start: '10:00', end: '12:00' },
    { start: '13:00', end: '15:00' },
  ];
  let nextSlotId = 1;
  for (const day of days) {
    for (const t of times) {
      timeSlots.push({ id: nextSlotId++, day, startTime: t.start, endTime: t.end });
    }
  }

  const lecturers: Lecturer[] = [
    { id: 1, name: 'Lec A', isStructural: false, maxSks: 12, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 2, name: 'Lec B', isStructural: false, maxSks: 12, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 3, name: 'Lec C', isStructural: false, maxSks: 12, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 4, name: 'Lec D', isStructural: false, maxSks: 12, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 5, name: 'Lec E', isStructural: false, maxSks: 12, preferredTimeSlotIds: [], competencies: ['core'] },
  ];

  const offerings: CourseOffering[] = lecturers.map((lec, idx) => {
    const courseId = idx + 1;
    const room = rooms[idx]!;
    return {
      id: idx + 1,
      courseId,
      course: {
        id: courseId,
        code: `EZ${courseId}`,
        name: `Easy Course ${courseId}`,
        sks: 3,
        requiredFacilities: [],
        requiredCompetencies: ['core'],
      },
      roomId: room.id,
      room,
      lecturers: [lec],
      effectiveStudentCount: 30,
      isFixed: false,
    };
  });

  return { rooms, timeSlots, lecturers, offerings };
}

// ─── Stagnation fixture ──────────────────────────────────────────
// Three FIXED offerings, all pinned to roomId=1, slot=1. Every chromosome
// produced by the GA will have at least 4 unavoidable hard violations
// (3 room collisions + 3 lecturer collisions among the three fixed genes
//  on the same (room, slot)). Fitness plateaus quickly, elitism preserves
// it, and after STAGNATION_WINDOW generations runGA must early-exit.
function buildStagnationCandidates(): {
  candidates: PreGACandidate[];
  lecturerStructuralMap: Map<number, boolean>;
  lecturerPreferenceMap: Map<number, Set<number>>;
  lecturerMaxSksMap: Map<number, number>;
} {
  const candidates: PreGACandidate[] = [
    {
      offeringId: 1,
      courseId: 1,
      roomId: 1,
      lecturerIds: [1],
      effectiveStudentCount: 30,
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
      siblingOfferingIds: [1],
      lecturerPool: [1],
      siblingLecturerGroups: [[1]],
    },
    {
      offeringId: 2,
      courseId: 2,
      roomId: 1,
      lecturerIds: [2],
      effectiveStudentCount: 30,
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
      siblingOfferingIds: [2],
      lecturerPool: [2],
      siblingLecturerGroups: [[2]],
    },
    {
      offeringId: 3,
      courseId: 3,
      roomId: 1,
      lecturerIds: [3],
      effectiveStudentCount: 30,
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
      siblingOfferingIds: [3],
      lecturerPool: [3],
      siblingLecturerGroups: [[3]],
    },
  ];
  const lecturerStructuralMap = new Map<number, boolean>([
    [1, false], [2, false], [3, false],
  ]);
  const lecturerPreferenceMap = new Map<number, Set<number>>([
    [1, new Set()], [2, new Set()], [3, new Set()],
  ]);
  const lecturerMaxSksMap = new Map<number, number>([
    [1, 12], [2, 12], [3, 12],
  ]);
  return { candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap };
}

// ─── 1. Easy-dataset convergence ────────────────────────────────
describe('Layer 3 integration — easy-dataset convergence', () => {
  it('runPreGA → runSSA → runGA reaches hardViolations === 0 on a small easy dataset', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();

    const { validation, candidates } = runPreGA(offerings, timeSlots);
    expect(validation.infeasible).toHaveLength(0);
    expect(candidates).toHaveLength(offerings.length);

    const ssaResult = runSSA(candidates, timeSlots);
    expect(ssaResult.status).toBe('FEASIBLE');

    const lecturerStructuralMap = new Map<number, boolean>(
      lecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      lecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, config);

    expect(result.hardViolations).toBe(0);
    expect(result.generationsRun).toBeLessThanOrEqual(config.generations);
    expect(result.bestChromosome).toHaveLength(candidates.length);
    // Easy dataset has plenty of supply; convergence should not require the
    // stagnation safety net.
    expect(result.stagnatedEarly).toBe(false);

    // Phase 15 task #23 — backward-compatibility guard. The easy dataset has
    // five courses each with exactly one offering, so cohort aggregation must
    // collapse to a single sibling and the legacy "every session shares
    // candidate.lecturerIds" stamp must hold (no per-session distribution).
    for (const cand of candidates) {
      expect(cand.siblingOfferingIds).toHaveLength(1);
      expect(cand.siblingOfferingIds[0]).toBe(cand.offeringId);
      // Single-sibling cohort: lecturerPool equals sorted lecturerIds.
      expect(cand.lecturerPool).toEqual(
        [...cand.lecturerIds].sort((a, b) => a - b),
      );
      // Single-sibling cohort: groups is a one-row matrix of sorted lecturerIds.
      expect(cand.siblingLecturerGroups).toEqual([
        [...cand.lecturerIds].sort((a, b) => a - b),
      ]);
    }

    // Sanity: every assigned slot is among the candidate's allowed slots,
    // AND every session of a single-offering gene carries the legacy
    // candidate.lecturerIds stamp verbatim (no per-session distribution).
    const candidateById = new Map(candidates.map(c => [c.offeringId, c]));
    for (const gene of result.bestChromosome) {
      const cand = candidateById.get(gene.offeringId)!;
      // Each gene has parallelSessionCount sessions, each with sessionDuration slots
      expect(gene.sessions).toHaveLength(cand.parallelSessionCount);
      for (const session of gene.sessions) {
        expect(session.timeSlotIds).toHaveLength(cand.sessionDuration);
        for (const slot of session.timeSlotIds) {
          expect(cand.possibleTimeSlotIds).toContain(slot);
        }
        // Phase 15 task #23 — single-sibling cohorts skip the multi-sibling
        // round-robin and stamp candidate.lecturerIds on every session. The
        // GA's lecturer-mutation operator is gated to multi-sibling cohorts
        // (`mutateLecturer` in src/ga/mutation.ts), so the seed stamp must
        // survive every generation of the legacy easy-dataset run.
        expect([...session.lecturerIds].sort((a, b) => a - b)).toEqual(
          [...cand.lecturerIds].sort((a, b) => a - b),
        );
      }
    }
  });
});

// ─── 2. Stagnation exit ─────────────────────────────────────────
describe('Layer 3 integration — stagnation exit', () => {
  it('runGA early-exits with stagnatedEarly=true when fitness cannot improve', async () => {
    const { candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap } = buildStagnationCandidates();

    // Generations budget large enough that the stagnation window (100) is
    // exhausted well before the budget runs out.
    const config: GAConfig = {
      populationSize: 20,
      generations: 500,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, config);

    expect(result.stagnatedEarly).toBe(true);
    expect(result.hardViolations).toBeGreaterThan(0);
    // Must have run at least STAGNATION_WINDOW generations to register
    // stagnation, but must have exited well before the full budget.
    expect(result.generationsRun).toBeGreaterThanOrEqual(100);
    expect(result.generationsRun).toBeLessThan(config.generations);
  });
});

// ─── 3. Fixed Room invariant across generations ─────────────────
describe('Layer 3 integration — Fixed Room invariant across generations', () => {
  it('FIXED genes preserve kind and roomId across every generation of an explicit GA loop', () => {
    // Run pre-GA on the seed dataset to obtain real Fixed Room candidates.
    const { validation, candidates } = runPreGA(seedCourseOfferings, seedTimeSlots);
    expect(validation.infeasible).toHaveLength(0);
    const fixedCandidates = candidates.filter(c => c.isFixedRoom);
    expect(fixedCandidates.length).toBeGreaterThan(0);

    const fixedRoomById = new Map(fixedCandidates.map(c => [c.offeringId, c.roomId]));

    const lecturerStructuralMap = new Map<number, boolean>(
      seedLecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      seedLecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      seedLecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 24,
      generations: 30,
      mutationRate: 0.2,         // higher mutation pressure stresses the invariant
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'uniform',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const fitnessConfig = {
      hardPenaltyWeight: config.hardPenaltyWeight,
      softPenaltyWeight: config.softPenaltyWeight,
    };
    const crossover = getCrossoverFn(config.crossoverType);

    function assertFixedInvariant(chromosome: Chromosome, label: string) {
      for (const gene of chromosome) {
        const expectedRoom = fixedRoomById.get(gene.offeringId);
        if (expectedRoom === undefined) continue; // not a fixed offering
        expect(gene.kind, `${label}: offering ${gene.offeringId} kind`).toBe('FIXED');
        // All sessions in a FIXED gene must retain the original roomId
        for (let si = 0; si < gene.sessions.length; si++) {
          expect(
            gene.sessions[si]!.roomId,
            `${label}: offering ${gene.offeringId} session ${si} roomId`
          ).toBe(expectedRoom);
        }
      }
    }

    let population: Chromosome[] = generateInitialPopulation(
      candidates, config.populationSize, config.noiseRate
    ).map(ch => repairChromosome(ch, candidates));

    for (const ch of population) assertFixedInvariant(ch, 'initial population');

    for (let gen = 0; gen < config.generations; gen++) {
      const evaluated = population.map(ch =>
        evaluateFitness(ch, candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, fitnessConfig)
      );
      evaluated.sort((a, b) => b.fitness - a.fitness);

      // Assert invariant on every chromosome in the current generation.
      for (const e of evaluated) assertFixedInvariant(e.chromosome, `gen ${gen} evaluated`);

      const newPopulation: Chromosome[] = [];
      for (let i = 0; i < config.elitismCount && i < evaluated.length; i++) {
        newPopulation.push(evaluated[i]!.chromosome);
      }
      while (newPopulation.length < config.populationSize) {
        const p1 = tournamentSelection(evaluated, config.tournamentSize);
        const p2 = tournamentSelection(evaluated, config.tournamentSize);
        let [c1, c2] = crossover(p1.chromosome, p2.chromosome);
        c1 = mutateChromosome(c1, candidates, config.mutationRate);
        c2 = mutateChromosome(c2, candidates, config.mutationRate);
        c1 = repairChromosome(c1, candidates);
        c2 = repairChromosome(c2, candidates);
        // Children must also satisfy the invariant immediately after each operator.
        assertFixedInvariant(c1, `gen ${gen} child1`);
        assertFixedInvariant(c2, `gen ${gen} child2`);
        newPopulation.push(c1, c2);
      }
      population = newPopulation.slice(0, config.populationSize);
    }
  });

  it('runGA bestChromosome preserves Fixed Room invariant when run end-to-end on the seed dataset', async () => {
    const { validation, candidates } = runPreGA(seedCourseOfferings, seedTimeSlots);
    expect(validation.infeasible).toHaveLength(0);

    const fixedRoomById = new Map(
      candidates.filter(c => c.isFixedRoom).map(c => [c.offeringId, c.roomId])
    );
    expect(fixedRoomById.size).toBeGreaterThan(0);

    const ssaResult = runSSA(candidates, seedTimeSlots);
    expect(ssaResult.status).toBe('FEASIBLE');

    const lecturerStructuralMap = new Map<number, boolean>(
      seedLecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      seedLecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      seedLecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 30,
      generations: 40,
      mutationRate: 0.15,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'pmx',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, config);

      for (const gene of result.bestChromosome) {
        const expectedRoom = fixedRoomById.get(gene.offeringId);
        if (expectedRoom === undefined) continue;
        expect(gene.kind).toBe('FIXED');
        // All sessions in a FIXED gene retain the original room
        for (const session of gene.sessions) {
          expect(session.roomId).toBe(expectedRoom);
        }
        // Fixed offerings must also stay pinned to their fixedTimeSlotIds.
        const cand = candidates.find(c => c.offeringId === gene.offeringId)!;
        if (cand.fixedTimeSlotIds && cand.fixedTimeSlotIds.length > 0) {
          for (const session of gene.sessions) {
            for (const slot of session.timeSlotIds) {
              expect(cand.fixedTimeSlotIds).toContain(slot);
            }
          }
        }
      }
  });
});

// ─── 4. Elitism monotonicity ────────────────────────────────────
describe('Layer 3 integration — elitism monotonicity', () => {
  it('best fitness in history[] is monotonically non-decreasing', async () => {
    // Use the seed dataset so the run exercises both FIXED and FLEXIBLE
    // genes plus structural / preference soft penalties.
    const { validation, candidates } = runPreGA(seedCourseOfferings, seedTimeSlots);
    expect(validation.infeasible).toHaveLength(0);
    const ssaResult = runSSA(candidates, seedTimeSlots);
    expect(ssaResult.status).toBe('FEASIBLE');

    const lecturerStructuralMap = new Map<number, boolean>(
      seedLecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      seedLecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      seedLecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 30,
      generations: 60,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, config);

    expect(result.history.length).toBeGreaterThan(1);
    // Elitism (elitismCount >= 1) guarantees the previous generation's best
    // chromosome survives unchanged into the next generation, so the next
    // generation's best fitness must be >= the current's.
    const EPS = 1e-12;
    for (let i = 1; i < result.history.length; i++) {
      expect(
        result.history[i]! + EPS >= result.history[i - 1]!,
        `history[${i}]=${result.history[i]} dropped below history[${i - 1}]=${result.history[i - 1]}`
      ).toBe(true);
    }
  });

  it('best fitness in history[] stays monotonic on the easy dataset', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    const { candidates } = runPreGA(offerings, timeSlots);
    const ssaResult = runSSA(candidates, timeSlots);
    expect(ssaResult.status).toBe('FEASIBLE');

    const lecturerStructuralMap = new Map<number, boolean>(
      lecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      lecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 20,
      generations: 30,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'uniform',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, lecturerMaxSksMap, config);

    // The easy dataset can converge in a single generation (perfect solution
    // discovered in the initial random population), in which case there is
    // nothing to compare. Otherwise check monotonicity pairwise.
    expect(result.history.length).toBeGreaterThanOrEqual(1);
    const EPS = 1e-12;
    for (let i = 1; i < result.history.length; i++) {
      expect(result.history[i]! + EPS >= result.history[i - 1]!).toBe(true);
    }
  });
});

// ─── 5. Phase 10: Fixed-time / flexible-room candidate end-to-end ───
describe('Layer 3 integration — Phase 10 fixed-time / flexible-room candidate', () => {
  it('runPreGA → runSSA → runGA completes when one offering has isFixed=true with roomId=null', async () => {
    // Build the easy dataset, then mutate offering #5 into the "fixed time,
    // flexible room" shape: time pinned via fixedTimeSlotIds, room left to
    // the GA. This is the Phase 10 user-story scenario — the bug it guards
    // against was: validator.ts pushed the offering's null roomId into
    // lockedRoomMap, entityTagger stamped isFixedRoom=true with roomId=null,
    // and the chromosome seeder crashed on the missing FIXED-gene roomId.
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();

    const target = offerings[4]!;
    // Use the first three Monday slots of the easy-dataset fixture
    // (id 1, 2, 3 — Monday 08:00–10:00, 10:00–12:00, 13:00–15:00) as the
    // fixed-time window. SKS=3 so the contiguous block needs 3 slots; the
    // first two are back-to-back, the third has a 13:00 gap. The chromosome
    // seeder's contiguous-block finder will fall back to a shuffled slice
    // when no fully-contiguous block exists, so the run still completes.
    const fixedTimeOffering: CourseOffering = {
      ...target,
      roomId: null, // ← Phase 10: no chosen / locked room
      fixedTimeSlotIds: [1, 2], // pin to a Monday morning back-to-back pair
      isFixed: true,
    };
    // Trim sks=2 so fixedTimeSlotIds covers the session duration exactly,
    // avoiding the seeder's shuffled-slice fallback path (which would
    // weaken the assertion that roomId comes from possibleRoomIds, not a
    // legacy default).
    fixedTimeOffering.course = { ...target.course, sks: 2 };
    const offeringsWithFixedTime = offerings.slice(0, 4).concat([fixedTimeOffering]);

    // Pre-GA must see allRooms to populate possibleRoomIds on the candidate.
    const { validation, candidates } = runPreGA(offeringsWithFixedTime, timeSlots, rooms);
    expect(validation.infeasible).toEqual([]);
    expect(candidates).toHaveLength(offeringsWithFixedTime.length);

    const targetCandidate = candidates.find(c => c.offeringId === fixedTimeOffering.id)!;
    // Phase 10 #1 + #2 invariant: fixed-time/flexible-room ⇒ FLEXIBLE candidate.
    expect(targetCandidate.isFixedRoom).toBe(false);
    expect(targetCandidate.roomId).toBeNull();
    // Phase 10 #5 invariant: possibleRoomIds populated even when isFixed=true.
    expect(targetCandidate.possibleRoomIds).toBeDefined();
    expect(targetCandidate.possibleRoomIds!.length).toBeGreaterThan(0);

    const ssaResult = runSSA(candidates, timeSlots);
    expect(ssaResult.status).toBe('FEASIBLE');

    const lecturerStructuralMap = new Map<number, boolean>(
      lecturers.map(l => [l.id, l.isStructural])
    );
    const lecturerPreferenceMap = new Map<number, Set<number>>(
      lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
    );
    const lecturerMaxSksMap = new Map<number, number>(
      lecturers.map(l => [l.id, l.maxSks])
    );

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const result = await runGA(
      candidates,
      lecturerStructuralMap,
      lecturerPreferenceMap,
      lecturerMaxSksMap,
      config,
    );

    // The pipeline must not crash. The user's reported scenario ("GA cannot
    // run whenever user creates new offering for this version") is fixed
    // when the run reaches any terminal state — SUCCESS preferred, but
    // STAGNATED is also non-crashing.
    expect(result.bestChromosome).toHaveLength(candidates.length);
    expect(result.generationsRun).toBeGreaterThanOrEqual(1);

    // The target gene must have a roomId from the candidate's possibleRoomIds
    // pool, NOT null. This is the regression guard for Phase 10 #6: the
    // chromosome seeder's random-pick path (chromosome.ts:154-164) actually
    // wired through and picked a real room.
    const targetGene = result.bestChromosome.find(
      g => g.offeringId === fixedTimeOffering.id,
    )!;
    expect(targetGene).toBeDefined();
    expect(targetGene.sessions.length).toBeGreaterThan(0);
    const pool = new Set(targetCandidate.possibleRoomIds!);
    for (const session of targetGene.sessions) {
      expect(session.roomId).not.toBeNull();
      expect(pool.has(session.roomId)).toBe(true);
    }
  });
});

// ─── 6. Phase 10 #6a + #6c: production-parity null-room offerings ──
describe('Pipeline integration — Phase 10 production parity (null room + LockedRoom)', () => {
  it('#6a: schedules an offering with room=null, roomId=null end-to-end (worker path)', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    // Mutate offering #5 to mirror production state: both room and roomId
    // null, no fixedTimeSlots, no LockedRoom. This is what the repo emits
    // for a UI-created offering with no room picked (see
    // src/repo/mappers/courseOfferingMapper.ts:44-50).
    const nullRoomOffering: CourseOffering = {
      ...offerings[4]!,
      roomId: null,
      room: null,
    };
    const offeringsWithNullRoom = offerings.slice(0, 4).concat([nullRoomOffering]);

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings: offeringsWithNullRoom,
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    // Pre-GA must accept the null-room offering. The reported bug today is
    // INTEGRITY_NO_ROOM rejection at src/pre-ga/checks.ts:33-35.
    expect(context.validation.infeasible).toEqual([]);
    expect(context.candidates).toHaveLength(offeringsWithNullRoom.length);

    const cand = context.candidates.find(c => c.offeringId === nullRoomOffering.id)!;
    expect(cand.isFixedRoom).toBe(false);
    expect(cand.roomId).toBeNull();
    expect(cand.possibleRoomIds).toBeDefined();
    expect(cand.possibleRoomIds!.length).toBeGreaterThan(0);
    // Phase 10 #6a: parallelSessionCount falls back to 1 when room is null.
    expect(cand.parallelSessionCount).toBe(1);

    // The GA must produce a final assignment for this offering — non-null
    // room drawn from the candidate's possibleRoomIds pool.
    expect(response.status === 'SUCCESS' || response.status === 'STAGNATED').toBe(true);
    const gaResult = response.gaResult!;
    const gene = gaResult.bestChromosome.find(g => g.offeringId === nullRoomOffering.id)!;
    expect(gene).toBeDefined();
    // Phase 11 task #17 — OQ-17 guard. The cohort (30) fits in every cap-40
    // room in the easy dataset, so this is a non-overflow null-room offering
    // and MUST stay single-session. Multi-session search is reserved for the
    // overflow path (Phase 11 task #16) and would expand the search space
    // gratuitously for the common case.
    expect(gene.sessions).toHaveLength(1);
    const pool = new Set(cand.possibleRoomIds!);
    for (const session of gene.sessions) {
      expect(session.roomId).not.toBeNull();
      expect(pool.has(session.roomId)).toBe(true);
    }
  });

  it('#6c: a LockedRoom row pins the offering to the locked room end-to-end', async () => {
    const { rooms: easyRooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    // Add a spare room that no other offering uses as its seed — needed to
    // sidestep the pre-existing AC-3 quirk where two candidates with the
    // same `session.roomId` (even if both FLEXIBLE) get a spurious shared-
    // room constraint. See src/ssa/ac3.ts:79-86 and Phase 10 #4 audit note.
    const spareRoom: Room = { id: 99, name: 'R-spare', capacity: 40, facilities: [] };
    const rooms = [...easyRooms, spareRoom];

    // Same null-room shape as #6a: production state with roomId=null, room=null.
    // The caller supplies a LockedRoom entry pinning the offering to the spare
    // room. Pre-#6c this row was discarded by the worker; post-#6c the
    // orchestrator builds a lockedRoomMap from it and the validator's
    // tagEntities stamps isFixedRoom=true on the candidate.
    const nullRoomOffering: CourseOffering = {
      ...offerings[4]!,
      roomId: null,
      room: null,
    };
    const offeringsWithLock = offerings.slice(0, 4).concat([nullRoomOffering]);
    const targetLockedRoomId = spareRoom.id;

    const lockedRooms: LockedRoom[] = [
      {
        id: 1,
        semesterId: 1,
        offeringId: nullRoomOffering.id,
        roomId: targetLockedRoomId,
        lockedById: 1,
        lockedAt: new Date(),
        reason: 'Integration test — Phase 10 #6c',
      },
    ];

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings: offeringsWithLock,
      timeSlots,
      rooms,
      lecturers,
      config,
      lockedRooms,
    });

    expect(context.validation.infeasible).toEqual([]);

    // The candidate must be tagged FIXED with the locked roomId.
    const cand = context.candidates.find(c => c.offeringId === nullRoomOffering.id)!;
    expect(cand.isFixedRoom).toBe(true);
    expect(cand.roomId).toBe(targetLockedRoomId);

    // Every session of this offering's gene must carry the locked roomId —
    // it's a FIXED gene by construction, immutable across mutation/crossover.
    const gaResult = response.gaResult!;
    const gene = gaResult.bestChromosome.find(g => g.offeringId === nullRoomOffering.id)!;
    expect(gene.kind).toBe('FIXED');
    for (const session of gene.sessions) {
      expect(session.roomId).toBe(targetLockedRoomId);
    }
  });
});

describe('Pipeline integration — Phase 11 null-room offering with capacity overflow', () => {
  it('splits a 90-student null-room offering into 3 parallel sessions across multiple rooms', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    // Mutate offering #5 to the null-room overflow shape: no LockedRoom and a
    // cohort larger than any single room's capacity. Every room in the easy
    // dataset has capacity 40, so 90 students require ⌈90/40⌉ = 3 parallel
    // sessions across different rooms (validator §141-167, OQ-15/16/17).
    const overflowOffering: CourseOffering = {
      ...offerings[4]!,
      roomId: null,
      room: null,
      effectiveStudentCount: 90,
    };
    const offeringsWithOverflow = offerings.slice(0, 4).concat([overflowOffering]);

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings: offeringsWithOverflow,
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    // Pre-GA must accept the overflow offering; no infeasibility.
    expect(context.validation.infeasible).toEqual([]);
    expect(context.candidates).toHaveLength(offeringsWithOverflow.length);

    const cand = context.candidates.find(c => c.offeringId === overflowOffering.id)!;
    expect(cand.isFixedRoom).toBe(false);
    expect(cand.roomId).toBeNull();
    // ⌈90/40⌉ = 3 — driven by the largest qualifying room's capacity.
    expect(cand.parallelSessionCount).toBe(3);
    expect(cand.possibleRoomIds!.length).toBeGreaterThan(0);

    // A terminal non-failure status. STAGNATED is accepted since the cohort-
    // capacity match is a soft signal — the GA might not perfectly zero
    // residual collisions inside the generation budget, but it should never
    // declare the run NO_FEASIBLE_CANDIDATES / INFEASIBLE.
    expect(['SUCCESS', 'STAGNATED']).toContain(response.status);

    const gaResult = response.gaResult!;
    const gene = gaResult.bestChromosome.find(g => g.offeringId === overflowOffering.id)!;
    expect(gene).toBeDefined();
    expect(gene.kind).toBe('FLEXIBLE');
    expect(gene.sessions).toHaveLength(3);

    // Every session's roomId is drawn from possibleRoomIds (non-null).
    const pool = new Set(cand.possibleRoomIds!);
    for (const session of gene.sessions) {
      expect(session.roomId).not.toBeNull();
      expect(pool.has(session.roomId)).toBe(true);
    }

    // OQ-18 invariant: sibling sessions MAY share a timeslot in different
    // rooms, but MUST NOT share both a room AND a slot (that's a room
    // collision — a hard violation). Enforced per-(room, slot) pair.
    const seen = new Set<string>();
    for (const session of gene.sessions) {
      for (const slotId of session.timeSlotIds) {
        const key = `${session.roomId}:${slotId}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    // Σ session.room.capacity >= effectiveStudentCount — the combined
    // per-session room capacity must accommodate the cohort.
    const roomById = new Map(rooms.map(r => [r.id, r]));
    const combinedCapacity = gene.sessions.reduce(
      (sum, s) => sum + (roomById.get(s.roomId)?.capacity ?? 0),
      0,
    );
    expect(combinedCapacity).toBeGreaterThanOrEqual(overflowOffering.effectiveStudentCount);
  });

  it('keeps single-room multi-timeslot split for pre-assigned-room overflow (OQ-16 regression)', async () => {
    // Phase 11 task #18 — guards OQ-16. A FIXED offering with a pre-assigned
    // room whose capacity is smaller than the cohort must split ACROSS
    // TIMESLOTS within the locked room — NOT across rooms (that path is
    // reserved for null-room offerings per task #16). The validator's strict
    // possibleRoomIds skip at src/pre-ga/validator.ts:99-102 routes
    // `isFixed && roomId !== null` directly to the legacy
    // `⌈students / room.capacity⌉` formula at line 188-189.
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    // Offering #1 is pinned to room 1 (capacity 40). Push the cohort to 80 →
    // ⌈80/40⌉ = 2 sessions. Open the fixed slot domain to two Mon/Tue 3-slot
    // blocks so the seeder can place the two sessions in distinct timeslots
    // without colliding with each other in the locked room.
    const overflowFixed: CourseOffering = {
      ...offerings[0]!,
      isFixed: true,
      fixedTimeSlotIds: [1, 2, 3, 4, 5, 6],
      effectiveStudentCount: 80,
    };
    const offeringsWithFixedOverflow = [overflowFixed, ...offerings.slice(1)];

    const config: GAConfig = {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings: offeringsWithFixedOverflow,
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    expect(context.validation.infeasible).toEqual([]);

    const cand = context.candidates.find(c => c.offeringId === overflowFixed.id)!;
    expect(cand.isFixedRoom).toBe(true);
    expect(cand.roomId).toBe(overflowFixed.roomId);
    // Legacy formula — ⌈80/40⌉ = 2 sessions, same locked room, different slots.
    expect(cand.parallelSessionCount).toBe(2);

    expect(['SUCCESS', 'STAGNATED']).toContain(response.status);

    const gaResult = response.gaResult!;
    const gene = gaResult.bestChromosome.find(g => g.offeringId === overflowFixed.id)!;
    expect(gene).toBeDefined();
    expect(gene.kind).toBe('FIXED');
    expect(gene.sessions).toHaveLength(2);

    // OQ-16 invariant: every session of a FIXED gene carries the locked room.
    // This is what distinguishes the pre-assigned overflow path from the new
    // null-room multi-room split.
    for (const session of gene.sessions) {
      expect(session.roomId).toBe(overflowFixed.roomId);
    }

    // The two sessions must occupy different timeslot blocks — that's the
    // whole point of the multi-timeslot split (otherwise they'd collide in
    // the locked room).
    const firstSlots = gene.sessions[0]!.timeSlotIds.slice().sort();
    const secondSlots = gene.sessions[1]!.timeSlotIds.slice().sort();
    expect(firstSlots).not.toEqual(secondSlots);
  });
});

// Phase 14 #14
describe('Pipeline integration — Phase 14 cross-semester defect end-to-end', () => {
  // Apply a post-mapper defect to an offering: the orphan id has already been
  // stripped from `lecturers[]` by `courseOfferingMapper.ts` and recorded in
  // `mappingDefects`. `checkIntegrity` reads that envelope at the top of the
  // function (`src/pre-ga/checks.ts:42-83`) BEFORE the empty-lecturers branch,
  // so this faithfully reproduces the orchestrator-level state without
  // touching production code.
  function withMappingDefect(
    offering: CourseOffering,
    defects: NonNullable<CourseOffering['mappingDefects']>,
  ): CourseOffering {
    const dropLecturers = (defects.missingLecturerIds?.length ?? 0) > 0;
    const dropRoom = defects.missingRoomId !== undefined && defects.missingRoomId !== null;
    return {
      ...offering,
      mappingDefects: defects,
      lecturers: dropLecturers ? [] : offering.lecturers,
      roomId: dropRoom ? null : offering.roomId,
      room: dropRoom ? null : offering.room,
    };
  }

  const baseConfig: GAConfig = {
    populationSize: 30,
    generations: 50,
    mutationRate: 0.1,
    elitismCount: 2,
    tournamentSize: 3,
    crossoverType: 'singlePoint',
    noiseRate: 0.15,
    hardPenaltyWeight: 100,
    softPenaltyWeight: 1,
  };

  it('rejects the single defective offering and reaches SUCCESS on the four survivors', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    const defectiveId = offerings[2]!.id;
    const offeringsWithDefect = offerings.map((o, idx) =>
      idx === 2
        ? withMappingDefect(o, { missingLecturerIds: [9999] })
        : o,
    );

    const { response, context } = await runPipeline({
      offerings: offeringsWithDefect,
      timeSlots,
      rooms,
      lecturers,
      config: baseConfig,
    });

    // Exactly one structured rejection — the defective offering.
    expect(context.validation.infeasible).toHaveLength(1);
    const rejection = context.validation.infeasible[0]!;
    expect(rejection.offering.id).toBe(defectiveId);
    expect(rejection.failedCheck.code).toBe('CROSS_SEMESTER_DEFECT');

    // Metadata envelope (src/pre-ga/checks.ts:76-82). `expectedSemesterId` may
    // be undefined since the mapper has no semester context — assert presence
    // of `field`, `mismatches`, and `fields` only.
    const metadata = rejection.failedCheck.metadata as {
      field: 'lecturerIds' | 'roomId';
      expectedSemesterId?: number;
      mismatches: Array<{ id: number; actualSemesterId?: number }>;
      fields: Array<{
        field: 'lecturerIds' | 'roomId';
        mismatches: Array<{ id: number }>;
      }>;
    };
    expect(metadata).toBeDefined();
    expect(metadata.field).toBe('lecturerIds');
    expect(metadata.mismatches).toEqual([{ id: 9999 }]);
    expect(metadata.fields).toHaveLength(1);
    expect(metadata.fields[0]!.field).toBe('lecturerIds');

    // The other four offerings survived Pre-GA and each became a candidate.
    expect(context.validation.feasible).toHaveLength(4);
    expect(context.candidates).toHaveLength(4);
    expect(context.candidates.find(c => c.offeringId === defectiveId)).toBeUndefined();

    // The GA reached a terminal non-failure state on the survivors. Mirroring
    // the Phase 10/11 tests, accept SUCCESS or STAGNATED — the orchestrator
    // returns 'SUCCESS' even when `gaResult.stagnatedEarly === true`.
    expect(response.status === 'SUCCESS' || response.status === 'STAGNATED').toBe(true);
    expect(response.gaResult).toBeDefined();
    expect(response.gaResult!.bestChromosome).toHaveLength(4);

    // The rejection propagates onto the wire envelope, metadata intact.
    expect(response.preGASummary.feasible).toBe(4);
    expect(response.preGASummary.infeasible).toHaveLength(1);
    const wireEntry = response.preGASummary.infeasible[0]!;
    expect(wireEntry.offeringId).toBe(defectiveId);
    expect(wireEntry.code).toBe('CROSS_SEMESTER_DEFECT');
    expect(wireEntry.metadata).toBeDefined();
    expect((wireEntry.metadata as { field: string }).field).toBe('lecturerIds');
  });

  it('rejects multiple per-offering defects without cascading to survivors', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    const lecturerDefectId = offerings[1]!.id;
    const roomDefectId = offerings[3]!.id;
    const offeringsWithDefects = offerings.map((o, idx) => {
      if (idx === 1) return withMappingDefect(o, { missingLecturerIds: [9001] });
      if (idx === 3) return withMappingDefect(o, { missingRoomId: 9002 });
      return o;
    });

    const { response, context } = await runPipeline({
      offerings: offeringsWithDefects,
      timeSlots,
      rooms,
      lecturers,
      config: baseConfig,
    });

    expect(context.validation.infeasible).toHaveLength(2);
    const byOffering = new Map(
      context.validation.infeasible.map(entry => [entry.offering.id, entry.failedCheck]),
    );
    expect(byOffering.get(lecturerDefectId)?.code).toBe('CROSS_SEMESTER_DEFECT');
    expect(byOffering.get(roomDefectId)?.code).toBe('CROSS_SEMESTER_DEFECT');

    const lecturerMetadata = byOffering.get(lecturerDefectId)!.metadata as { field: string };
    const roomMetadata = byOffering.get(roomDefectId)!.metadata as { field: string };
    expect(lecturerMetadata.field).toBe('lecturerIds');
    expect(roomMetadata.field).toBe('roomId');

    // Three survivors reach GA completion.
    expect(context.validation.feasible).toHaveLength(3);
    expect(context.candidates).toHaveLength(3);
    expect(response.status === 'SUCCESS' || response.status === 'STAGNATED').toBe(true);
    expect(response.gaResult).toBeDefined();
    expect(response.gaResult!.bestChromosome).toHaveLength(3);

    expect(response.preGASummary.feasible).toBe(3);
    expect(response.preGASummary.infeasible).toHaveLength(2);
    for (const entry of response.preGASummary.infeasible) {
      expect(entry.code).toBe('CROSS_SEMESTER_DEFECT');
      expect(entry.metadata).toBeDefined();
    }
  });

  it('returns NO_FEASIBLE_CANDIDATES when every offering carries a defect', async () => {
    const { rooms, timeSlots, lecturers, offerings } = buildEasyDataset();
    // Five offerings, five distinct orphan ids. Alternate field types so the
    // assertion covers both branches of the defect envelope.
    const offeringsAllDefective = offerings.map((o, idx) =>
      idx % 2 === 0
        ? withMappingDefect(o, { missingLecturerIds: [10000 + idx] })
        : withMappingDefect(o, { missingRoomId: 20000 + idx }),
    );

    const { response, context } = await runPipeline({
      offerings: offeringsAllDefective,
      timeSlots,
      rooms,
      lecturers,
      config: baseConfig,
    });

    expect(context.validation.infeasible).toHaveLength(5);
    expect(context.validation.feasible).toHaveLength(0);
    expect(context.candidates).toHaveLength(0);
    for (const entry of context.validation.infeasible) {
      expect(entry.failedCheck.code).toBe('CROSS_SEMESTER_DEFECT');
      expect(entry.failedCheck.metadata).toBeDefined();
    }

    // Empty candidate list short-circuits the orchestrator to the
    // NO_FEASIBLE_CANDIDATES branch (src/orchestrator.ts:106-122) — no
    // ssaResult, no gaResult.
    expect(response.status).toBe('NO_FEASIBLE_CANDIDATES');
    expect(response.gaResult).toBeUndefined();
    expect(response.ssaResult).toBeUndefined();
    expect(response.preGASummary.feasible).toBe(0);
    expect(response.preGASummary.infeasible).toHaveLength(5);
    for (const entry of response.preGASummary.infeasible) {
      expect(entry.code).toBe('CROSS_SEMESTER_DEFECT');
      expect(entry.metadata).toBeDefined();
    }
  });
});

// ─── Phase 15 — Shared-cohort lecturer distribution ─────────────
//
// The user-reported scenario from backlog Phase 15 task #22: two offerings
// of the same course (IF301) in the same semester, each taught by a different
// lecturer. 97 students into 30-cap rooms → ⌈97/30⌉ = 4 parallel sessions.
// Under the new cohort model (OQ-22 default — siblings keyed on courseId),
// Pre-GA aggregates the two offerings into ONE candidate; the GA produces
// ONE gene with 4 sessions; the 4 sessions hold lecturerIds distributed
// across {X, Y} so each lecturer teaches their share of the cohort instead
// of each offering scheduling its own 4 sessions (the pre-Phase-15 bug).
describe('Pipeline integration — Phase 15 shared-cohort lecturer distribution', () => {
  it("produces ONE cohort gene with 4 sessions split across the cohort's lecturer pool", async () => {
    // Four 30-cap rooms — every qualifying room is the same capacity so the
    // null-room overflow formula resolves to ⌈97/30⌉ = 4 parallel sessions.
    const rooms: Room[] = [
      { id: 1, name: 'R-201', capacity: 30, facilities: [] },
      { id: 2, name: 'R-202', capacity: 30, facilities: [] },
      { id: 3, name: 'R-203', capacity: 30, facilities: [] },
      { id: 4, name: 'R-204', capacity: 30, facilities: [] },
    ];

    // sks=1 keeps each session a single contiguous slot; 5 days × 3 slots
    // gives the GA enough room/slot variety to converge on a valid placement.
    const timeSlots: TimeSlot[] = [];
    {
      let nextId = 1;
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
        for (const t of [
          { start: '08:00', end: '08:50' },
          { start: '09:00', end: '09:50' },
          { start: '10:00', end: '10:50' },
        ]) {
          timeSlots.push({ id: nextId++, day, startTime: t.start, endTime: t.end });
        }
      }
    }

    // Lecturers X (id 10) and Y (id 20). maxSks=2 makes the soft loadPenalty
    // actively pull toward a 2/2 split — any imbalanced distribution pushes
    // one lecturer over cap. lecturerPool is sorted ascending so the pool is
    // deterministically [10, 20] for the assertion.
    const lecturerX: Lecturer = {
      id: 10,
      name: 'Mr. X',
      isStructural: false,
      maxSks: 2,
      preferredTimeSlotIds: [],
      competencies: ['core'],
    };
    const lecturerY: Lecturer = {
      id: 20,
      name: 'Mr. Y',
      isStructural: false,
      maxSks: 2,
      preferredTimeSlotIds: [],
      competencies: ['core'],
    };
    const lecturers = [lecturerX, lecturerY];

    const course = {
      id: 1,
      code: 'IF301',
      name: 'Algoritma',
      sks: 1,
      requiredFacilities: [],
      requiredCompetencies: ['core'],
    };

    // Two offerings, same (courseId), different lecturers — the trigger for
    // Pre-GA cohort aggregation. roomId/room null → null-room overflow path,
    // which fans the cohort across qualifying rooms.
    const offerings: CourseOffering[] = [
      {
        id: 100,
        courseId: course.id,
        course,
        roomId: null,
        room: null,
        lecturers: [lecturerX],
        effectiveStudentCount: 97,
        isFixed: false,
      },
      {
        id: 200,
        courseId: course.id,
        course,
        roomId: null,
        room: null,
        lecturers: [lecturerY],
        effectiveStudentCount: 97,
        isFixed: false,
      },
    ];

    const config: GAConfig = {
      populationSize: 40,
      generations: 80,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings,
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    // ─── Cohort aggregation invariants ─────────────────────────────
    expect(context.validation.infeasible).toEqual([]);
    expect(context.candidates).toHaveLength(1);

    const cand = context.candidates[0]!;
    expect(cand.courseId).toBe(course.id);
    expect(cand.siblingOfferingIds).toEqual([100, 200]);
    expect(cand.lecturerPool).toEqual([lecturerX.id, lecturerY.id]); // [10, 20]
    expect(cand.parallelSessionCount).toBe(4); // ⌈97 / 30⌉
    expect(cand.sessionDuration).toBe(1);
    expect(cand.effectiveStudentCount).toBe(97); // OQ-23 default: max(siblings)
    expect(cand.siblingLecturerGroups).toEqual([[lecturerX.id], [lecturerY.id]]);

    // ─── GA result invariants ──────────────────────────────────────
    expect(['SUCCESS', 'STAGNATED']).toContain(response.status);

    const gaResult = response.gaResult!;
    expect(gaResult).toBeDefined();
    // The cohort merge means the chromosome has ONE gene for the course,
    // not two — same-course offerings collapse into a single locus.
    expect(gaResult.bestChromosome).toHaveLength(1);

    const gene = gaResult.bestChromosome[0]!;
    expect(gene.offeringId).toBe(100); // primary sibling (lowest id)
    expect(gene.kind).toBe('FLEXIBLE');
    expect(gene.sessions).toHaveLength(4);

    // 4 sessions × 1 lecturer-assignment each = 4 lecturer-assignments total.
    // Each session carries a single lecturer (sibling round-robin seed; lecturer
    // mutation re-picks single-cardinality from the pool).
    let totalLecturerAssignments = 0;
    const lecturerCounts = new Map<number, number>([
      [lecturerX.id, 0],
      [lecturerY.id, 0],
    ]);
    for (const session of gene.sessions) {
      expect(session.lecturerIds.length).toBeGreaterThanOrEqual(1);
      totalLecturerAssignments += session.lecturerIds.length;
      for (const lid of session.lecturerIds) {
        expect([lecturerX.id, lecturerY.id]).toContain(lid);
        lecturerCounts.set(lid, (lecturerCounts.get(lid) ?? 0) + 1);
      }
    }
    expect(totalLecturerAssignments).toBe(4);

    // Both lecturers appear at least once — loadPenalty (maxSks=2) penalises
    // any chromosome that gives a single lecturer all 4 sessions, so the GA
    // converges on a split distribution. Tight 2/2 is the seeder default and
    // the lowest-penalty distribution.
    expect(lecturerCounts.get(lecturerX.id)).toBeGreaterThanOrEqual(1);
    expect(lecturerCounts.get(lecturerY.id)).toBeGreaterThanOrEqual(1);
  });

  // Phase 15 task #24 — composition guard for the Phase 11 null-room overflow
  // path and the Phase 15 cohort grouping. 110 students into 30-cap rooms
  // forces ⌈110/30⌉ = 4 parallel sessions; three offerings of the same course
  // collapse into ONE cohort whose lecturerPool is the deduplicated union of
  // [X, Y, Z]. The 4-session bucket distributes across 3 lecturers via the
  // seeder's sibling round-robin (sibling[i % 3] owns session i → 2 sessions
  // for the first sibling, 1 each for the other two).
  it('composes Phase 11 null-room overflow with Phase 15 cohort grouping (3-sibling cohort, 4 sessions)', async () => {
    const rooms: Room[] = [
      { id: 1, name: 'R-201', capacity: 30, facilities: [] },
      { id: 2, name: 'R-202', capacity: 30, facilities: [] },
      { id: 3, name: 'R-203', capacity: 30, facilities: [] },
      { id: 4, name: 'R-204', capacity: 30, facilities: [] },
    ];

    const timeSlots: TimeSlot[] = [];
    {
      let nextId = 1;
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
        for (const t of [
          { start: '08:00', end: '08:50' },
          { start: '09:00', end: '09:50' },
          { start: '10:00', end: '10:50' },
        ]) {
          timeSlots.push({ id: nextId++, day, startTime: t.start, endTime: t.end });
        }
      }
    }

    const lecturerX: Lecturer = {
      id: 10,
      name: 'Mr. X',
      isStructural: false,
      maxSks: 2,
      preferredTimeSlotIds: [],
      competencies: ['core'],
    };
    const lecturerY: Lecturer = {
      id: 20,
      name: 'Mr. Y',
      isStructural: false,
      maxSks: 2,
      preferredTimeSlotIds: [],
      competencies: ['core'],
    };
    const lecturerZ: Lecturer = {
      id: 30,
      name: 'Mr. Z',
      isStructural: false,
      maxSks: 2,
      preferredTimeSlotIds: [],
      competencies: ['core'],
    };
    const lecturers = [lecturerX, lecturerY, lecturerZ];

    const course = {
      id: 1,
      code: 'IF301',
      name: 'Algoritma',
      sks: 1,
      requiredFacilities: [],
      requiredCompetencies: ['core'],
    };

    const offerings: CourseOffering[] = [
      {
        id: 100,
        courseId: course.id,
        course,
        roomId: null,
        room: null,
        lecturers: [lecturerX],
        effectiveStudentCount: 110,
        isFixed: false,
      },
      {
        id: 200,
        courseId: course.id,
        course,
        roomId: null,
        room: null,
        lecturers: [lecturerY],
        effectiveStudentCount: 110,
        isFixed: false,
      },
      {
        id: 300,
        courseId: course.id,
        course,
        roomId: null,
        room: null,
        lecturers: [lecturerZ],
        effectiveStudentCount: 110,
        isFixed: false,
      },
    ];

    const config: GAConfig = {
      populationSize: 40,
      generations: 80,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings,
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    // ─── Cohort aggregation invariants ─────────────────────────────
    expect(context.validation.infeasible).toEqual([]);
    expect(context.candidates).toHaveLength(1);

    const cand = context.candidates[0]!;
    expect(cand.courseId).toBe(course.id);
    expect(cand.siblingOfferingIds).toEqual([100, 200, 300]);
    expect(cand.lecturerPool).toEqual([lecturerX.id, lecturerY.id, lecturerZ.id]);
    expect(cand.parallelSessionCount).toBe(4); // ⌈110 / 30⌉
    expect(cand.effectiveStudentCount).toBe(110); // OQ-23 default: max(siblings)
    expect(cand.siblingLecturerGroups).toEqual([
      [lecturerX.id],
      [lecturerY.id],
      [lecturerZ.id],
    ]);

    // Phase 11 overflow invariant — null-room cohort emits possibleRoomIds.
    expect(cand.roomId).toBeNull();
    expect(cand.possibleRoomIds).toBeDefined();
    expect(cand.possibleRoomIds!.length).toBeGreaterThan(0);

    // ─── GA result invariants ──────────────────────────────────────
    expect(['SUCCESS', 'STAGNATED']).toContain(response.status);

    const gaResult = response.gaResult!;
    expect(gaResult).toBeDefined();
    // Three offerings collapse into ONE chromosome locus.
    expect(gaResult.bestChromosome).toHaveLength(1);

    const gene = gaResult.bestChromosome[0]!;
    expect(gene.offeringId).toBe(100); // lowest sibling id is the primary
    expect(gene.kind).toBe('FLEXIBLE');
    expect(gene.sessions).toHaveLength(4);

    // Phase 11 invariant: every session's roomId is drawn from possibleRoomIds.
    const roomPool = new Set(cand.possibleRoomIds!);
    for (const session of gene.sessions) {
      expect(roomPool.has(session.roomId)).toBe(true);
    }

    // 4 sessions × 1 lecturer-assignment each = 4 total.
    let totalLecturerAssignments = 0;
    const lecturerCounts = new Map<number, number>([
      [lecturerX.id, 0],
      [lecturerY.id, 0],
      [lecturerZ.id, 0],
    ]);
    for (const session of gene.sessions) {
      expect(session.lecturerIds.length).toBeGreaterThanOrEqual(1);
      totalLecturerAssignments += session.lecturerIds.length;
      for (const lid of session.lecturerIds) {
        expect([lecturerX.id, lecturerY.id, lecturerZ.id]).toContain(lid);
        lecturerCounts.set(lid, (lecturerCounts.get(lid) ?? 0) + 1);
      }
    }
    expect(totalLecturerAssignments).toBe(4);

    // All three lecturers participate in the cohort — sibling round-robin
    // seeds 2/1/1 and the soft loadPenalty (maxSks=2 per lecturer) keeps the
    // distribution close to balanced. Strict equality on the per-lecturer
    // count would be brittle against mutation drift; the contract is just
    // "the lecturer pool is exercised, not concentrated on one teacher".
    let lecturersWithAtLeastOneSession = 0;
    for (const count of lecturerCounts.values()) {
      if (count >= 1) lecturersWithAtLeastOneSession++;
    }
    expect(lecturersWithAtLeastOneSession).toBeGreaterThanOrEqual(2);
    // No lecturer should be loaded with all 4 sessions — that would violate
    // maxSks=2 and pull a soft penalty of 2; the GA prefers any other
    // distribution.
    for (const count of lecturerCounts.values()) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });
});

// ─── Phase 16 — fragmented session visibility (LOAD-BEARING) ─────
//
// This is the load-bearing acceptance test for the whole of Phase 16. It
// replicates the user-reported UPJ scenario byte-for-byte: a 5-SKS course
// on a timetable that fragments Mon-Thu into four 3-slot blocks with
// 10-minute coffee breaks at 10:00 / 12:40 / 15:20, plus Friday with the
// Jum'at prayer break at 11:50-13:00 (Q4). Pre-Phase-16 code silently
// shipped wrong schedules for this shape (Q2 confirmed 4-6 SKS courses
// are common, not edge cases). The seven assertions below pin every layer
// of the Phase 16 visibility loop:
//
//   (a) Pre-GA stays Q3=B (best-effort) — the 5-SKS offering is NOT
//       rejected, just flagged.
//   (b) preGASummary.warnings[] (Phase 16 #2) surfaces the offering with
//       fragmentationRequired: true and code 'FRAGMENTATION_REQUIRED'.
//   (c) The run reaches SUCCESS — no PRE_GA_EMPTY, no SSA_INFEASIBLE.
//   (d) The best chromosome carries fragmentationPenalty > 0 (Phase 16 #6),
//       so the GA's fitness signal is non-zero and the term contributes to
//       evolution pressure.
//   (e) The seeded / evolved gene's 5 session slots fall on a SINGLE day
//       (OQ-33 default — never crosses days, per Phase 16 #4/#5/#7).
//   (f) SSA.degradedOfferings (Phase 16 #9) lists the offering — the SSA
//       layer's per-slot fallback was needed to keep the bipartite match
//       feasible.
//   (g) The orchestrator response carries both visibility channels
//       (warnings + degradedOfferings) so the HTTP wire (Phase 16 #13) and
//       the frontend panel (Phase 16 #15) have data to render.
describe('Pipeline integration — Phase 16 fragmented session visibility (LOAD-BEARING)', () => {
  it('5-SKS course on a 3-slot-max UPJ timetable: pipeline completes with full visibility down to the gene', async () => {
    const rooms: Room[] = [
      { id: 1, name: 'R-A', capacity: 40, facilities: [] },
    ];

    // Mon-Thu: four contiguous 3-slot blocks per day separated by 10-min
    // coffee breaks at 10:00 / 12:40 / 15:20. Slots are 50 min apiece
    // (1 SKS = 1 timeslot per techspec).
    const monThuTimes = [
      { start: '07:30', end: '08:20' },
      { start: '08:20', end: '09:10' },
      { start: '09:10', end: '10:00' },
      { start: '10:10', end: '11:00' },
      { start: '11:00', end: '11:50' },
      { start: '11:50', end: '12:40' },
      { start: '12:50', end: '13:40' },
      { start: '13:40', end: '14:30' },
      { start: '14:30', end: '15:20' },
      { start: '15:30', end: '16:20' },
      { start: '16:20', end: '17:10' },
      { start: '17:10', end: '18:00' },
    ];
    // Friday: morning 3-block, then a 2-slot run truncated by the Jum'at
    // break (11:50-13:00, wider than the Mon-Thu coffee breaks), then a
    // 3-slot afternoon block. OQ-32 strict equality treats both break
    // widths as hard breaks — the Jum'at gap must not bridge runs.
    const friTimes = [
      { start: '07:30', end: '08:20' },
      { start: '08:20', end: '09:10' },
      { start: '09:10', end: '10:00' },
      { start: '10:10', end: '11:00' },
      { start: '11:00', end: '11:50' },
      { start: '13:00', end: '13:50' },
      { start: '13:50', end: '14:40' },
      { start: '14:40', end: '15:30' },
    ];

    const timeSlots: TimeSlot[] = [];
    let nextSlotId = 1;
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu']) {
      for (const t of monThuTimes) {
        timeSlots.push({ id: nextSlotId++, day, startTime: t.start, endTime: t.end });
      }
    }
    for (const t of friTimes) {
      timeSlots.push({ id: nextSlotId++, day: 'Fri', startTime: t.start, endTime: t.end });
    }

    const lecturers: Lecturer[] = [
      {
        id: 1,
        name: 'Lec',
        isStructural: false,
        maxSks: 12,
        preferredTimeSlotIds: [],
        competencies: ['core'],
      },
    ];

    const offering5Sks: CourseOffering = {
      id: 1,
      courseId: 1,
      course: {
        id: 1,
        code: 'BIG501',
        name: 'Heavy 5-SKS Course',
        sks: 5,
        requiredFacilities: [],
        requiredCompetencies: ['core'],
      },
      roomId: 1,
      room: rooms[0]!,
      lecturers,
      effectiveStudentCount: 30,
      isFixed: false,
    };

    const config: GAConfig = {
      populationSize: 20,
      generations: 30,
      mutationRate: 0.1,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverType: 'singlePoint',
      noiseRate: 0.15,
      hardPenaltyWeight: 100,
      softPenaltyWeight: 1,
    };

    const { response, context } = await runPipeline({
      offerings: [offering5Sks],
      timeSlots,
      rooms,
      lecturers,
      config,
    });

    // (a) Pre-GA keeps the 5-SKS offering feasible (Q3=B). It is NOT in
    //     validation.infeasible.
    expect(
      context.validation.infeasible.find((e) => e.offering.id === offering5Sks.id),
    ).toBeUndefined();
    expect(context.validation.feasible.map((o) => o.id)).toContain(offering5Sks.id);

    // (b) preGASummary.warnings[] surfaces the offering with
    //     fragmentationRequired: true and code FRAGMENTATION_REQUIRED.
    const warning = response.preGASummary.warnings.find(
      (w) => w.offeringId === offering5Sks.id,
    );
    expect(warning).toBeDefined();
    expect(warning!.code).toBe('FRAGMENTATION_REQUIRED');
    expect(warning!.fragmentationRequired).toBe(true);
    expect(warning!.sessionDuration).toBe(5);
    expect(warning!.longestContiguousRun).toBe(3);

    // (c) The pipeline reaches SUCCESS — never PRE_GA_EMPTY, never
    //     SSA_INFEASIBLE. (Worker maps SUCCESS → COMPLETED on persist.)
    expect(response.status).toBe('SUCCESS');
    expect(response.gaResult).toBeDefined();

    // (e) The resulting gene's 5 session slots all fall on a SINGLE day —
    //     OQ-33 default forbids cross-day spans. Asserted before (d) so a
    //     same-day failure surfaces with a clearer signature than the
    //     re-evaluation noise.
    const gene = response.gaResult!.bestChromosome.find(
      (g) => g.offeringId === offering5Sks.id,
    );
    expect(gene).toBeDefined();
    expect(gene!.sessions).toHaveLength(1);
    const session = gene!.sessions[0]!;
    expect(session.timeSlotIds).toHaveLength(5);
    const slotById = new Map(timeSlots.map((s) => [s.id, s]));
    const days = new Set(session.timeSlotIds.map((id) => slotById.get(id)!.day));
    expect(days.size).toBe(1);

    // (d) fragmentationPenalty > 0 in the final fitness payload. GAResult
    //     only carries `softPenalty` (sum); re-evaluate the best chromosome
    //     against the candidate context to extract the per-term breakdown.
    //     The candidate's longestContiguousRun is 3 and the session is 5
    //     same-day slots, so at least one in-day gap (the 10-min break) is
    //     unavoidable → the term must be strictly positive.
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const evaluated = evaluateFitness(
      response.gaResult!.bestChromosome,
      context.candidates,
      context.lecturerStructuralMap,
      context.lecturerPreferenceMap,
      context.lecturerMaxSksMap,
      { hardPenaltyWeight: 100, softPenaltyWeight: 1 },
      context.competencyEligibilityMap,
      roomById,
      slotById,
    );
    expect(evaluated.fragmentationPenalty).toBeGreaterThan(0);

    // (f) SSA.degradedOfferings lists the offering — the bipartite
    //     adjacency had to use the per-slot fallback for a sessionDuration
    //     no day's contiguous run could hold.
    expect(response.ssaResult).toBeDefined();
    expect(response.ssaResult!.degradedOfferings).toContain(offering5Sks.id);
    // SSA stays FEASIBLE per Q3=B — degraded is a visibility flag, not a
    // rejection signal.
    expect(response.ssaResult!.status).toBe('FEASIBLE');

    // (g) Both visibility channels are exposed on the orchestrator response
    //     so the HTTP wire (Phase 16 #13) can synthesize the top-level
    //     `degradedOfferings` + `fragmentationRequired` for the Run Detail
    //     panel (Phase 16 #15). The panel consumes the union; both lists
    //     containing this offering is the steady-state expectation under
    //     this scenario, not a duplicate.
    expect(Array.isArray(response.preGASummary.warnings)).toBe(true);
    expect(response.preGASummary.warnings.length).toBeGreaterThan(0);
    expect(response.ssaResult!.degradedOfferings.length).toBeGreaterThan(0);
  });
});
