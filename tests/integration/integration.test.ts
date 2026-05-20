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
  PreGACandidate,
  Room,
  TimeSlot,
} from '../../src/types.js';
import { runPreGA } from '../../src/pre-ga/validator.js';
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
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
    },
    {
      offeringId: 2,
      courseId: 2,
      roomId: 1,
      lecturerIds: [2],
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
    },
    {
      offeringId: 3,
      courseId: 3,
      roomId: 1,
      lecturerIds: [3],
      parallelSessionCount: 1,
      sessionDuration: 1,
      possibleTimeSlotIds: [1],
      isFixedRoom: true,
      fixedTimeSlotIds: [1],
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
    // Sanity: every assigned slot is among the candidate's allowed slots.
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
