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
