/**
 * Black-box integration tests — techspec §10.2 (Phase 6, Task 1).
 *
 * Eleven scenarios exercising the full pipeline (runPipeline) end-to-end:
 *   1.  Feasible simple         — 5 offerings, 10 slots, 5 rooms → hardViolations = 0
 *   2.  SSA Phase 0 trigger     — 2 fixed + 1 flexible same room, 2 slots → INFEASIBLE
 *   3.  AC-3 abort              — 2 sessions same room, both domain = [slot_1 only] → AC3_DOMAIN_EMPTY
 *   4.  Hopcroft-Karp abort     — 3 sessions competing for 2 exclusive slots → BIPARTITE_MATCHING_INSUFFICIENT
 *   5.  Partial infeasibility   — 20 offerings, 2 fail Pre-GA checks → GA runs on 18 only
 *   6.  Parallel class          — 60-student offering, 30-cap room → 2 sessions, both scheduled
 *   7.  Team teaching           — Offering with 2 lecturers → both blocked at assigned slot
 *   8.  Fixed Room invariant    — 5 offerings, 3 locked → locked rooms unchanged
 *   9.  Competency mismatch     — Lecturer with no overlap → Pre-GA rejects COMPETENCY_MISMATCH
 *  10.  Competency open assign  — requiredCompetencies = [] → Pre-GA passes
 *  11.  Crossover comparison    — Same dataset × 3 strategies → fitness curves per strategy
 *
 * All tests use runPipeline as a pure black-box entry point — no internal
 * imports except types and the seed data adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPipeline, type OrchestratorInput } from '../../src/orchestrator.js';
import type {
  CourseOffering,
  Course,
  GAConfig,
  Lecturer,
  Room,
  TimeSlot,
} from '../../src/types.js';

// ─── Console suppression ─────────────────────────────────────────
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Shared helpers ──────────────────────────────────────────────

function makeSlots(count: number): TimeSlot[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const slots: TimeSlot[] = [];
  let id = 1;
  for (let d = 0; d < days.length && slots.length < count; d++) {
    for (let h = 0; h < 12 && slots.length < count; h++) {
      const start = `${String(7 + h).padStart(2, '0')}:00`;
      const end = `${String(8 + h).padStart(2, '0')}:00`;
      slots.push({ id: id++, day: days[d]!, startTime: start, endTime: end });
    }
  }
  return slots;
}

function makeRoom(id: number, capacity = 40, facilities: string[] = []): Room {
  return { id, name: `R-${id}`, capacity, facilities };
}

function makeLecturer(
  id: number,
  competencies: string[] = ['general'],
  opts: Partial<Lecturer> = {},
): Lecturer {
  return {
    id,
    name: `Lec-${id}`,
    isStructural: false,
    preferredTimeSlotIds: [],
    competencies,
    ...opts,
  };
}

function makeCourse(
  id: number,
  sks = 1,
  requiredFacilities: string[] = [],
  requiredCompetencies: string[] = [],
): Course {
  return {
    id,
    code: `C${id}`,
    name: `Course ${id}`,
    sks,
    requiredFacilities,
    requiredCompetencies,
  };
}

function makeOffering(
  id: number,
  course: Course,
  room: Room,
  lecturers: Lecturer[],
  students: number,
  opts: Partial<CourseOffering> = {},
): CourseOffering {
  return {
    id,
    courseId: course.id,
    course,
    roomId: room.id,
    room,
    lecturers,
    effectiveStudentCount: students,
    isFixed: false,
    ...opts,
  };
}

const DEFAULT_CONFIG: GAConfig = {
  populationSize: 30,
  generations: 60,
  mutationRate: 0.1,
  elitismCount: 2,
  tournamentSize: 3,
  crossoverType: 'uniform',
  noiseRate: 0.15,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
};

// ─── 1. Feasible simple ─────────────────────────────────────────
describe('§10.2 Scenario 1 — Feasible simple', () => {
  it('5 offerings, 10 slots, 5 rooms → hardViolations = 0', async () => {
    const rooms = Array.from({ length: 5 }, (_, i) => makeRoom(i + 1, 40));
    const slots = makeSlots(10);
    const lecturers = Array.from({ length: 5 }, (_, i) => makeLecturer(i + 1));
    const offerings = lecturers.map((lec, i) => {
      const course = makeCourse(i + 1, 1);
      return makeOffering(i + 1, course, rooms[i]!, [lec], 30);
    });

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms, lecturers, config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('SUCCESS');
    expect(result.response.preGASummary.infeasible).toHaveLength(0);
    expect(result.response.ssaResult!.status).toBe('FEASIBLE');
    expect(result.response.gaResult!.hardViolations).toBe(0);
  });
});

// ─── 2. SSA Phase 0 trigger ─────────────────────────────────────
describe('§10.2 Scenario 2 — SSA Phase 0 trigger', () => {
  it('2 fixed + 1 flexible same room, only 2 slots → INFEASIBLE', async () => {
    const room = makeRoom(1, 40);
    const slots = makeSlots(2);
    const lecs = Array.from({ length: 3 }, (_, i) => makeLecturer(i + 1));

    const c1 = makeCourse(1, 1);
    const c2 = makeCourse(2, 1);
    const c3 = makeCourse(3, 1);

    const offerings: CourseOffering[] = [
      makeOffering(1, c1, room, [lecs[0]!], 30, {
        isFixed: true, fixedTimeSlotIds: [1],
      }),
      makeOffering(2, c2, room, [lecs[1]!], 30, {
        isFixed: true, fixedTimeSlotIds: [2],
      }),
      makeOffering(3, c3, room, [lecs[2]!], 30),
    ];

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms: [room], lecturers: lecs, config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('INFEASIBLE');
    expect(result.response.ssaResult!.status).toBe('INFEASIBLE');
  });
});

// ─── 3. AC-3 abort ──────────────────────────────────────────────
describe('§10.2 Scenario 3 — AC-3 abort', () => {
  it('2 sessions same room, both domain = [slot_1 only] → AC3_DOMAIN_EMPTY', async () => {
    const room = makeRoom(1, 40);
    const slots = makeSlots(1);
    const lecs = [makeLecturer(1), makeLecturer(2)];

    const c1 = makeCourse(1, 1);
    const c2 = makeCourse(2, 1);

    const offerings: CourseOffering[] = [
      makeOffering(1, c1, room, [lecs[0]!], 30, {
        isFixed: true, fixedTimeSlotIds: [1],
      }),
      makeOffering(2, c2, room, [lecs[1]!], 30, {
        isFixed: true, fixedTimeSlotIds: [1],
      }),
    ];

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms: [room], lecturers: lecs, config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('INFEASIBLE');
    expect(result.response.ssaResult!.deadlockReport).toBeDefined();
    expect(result.response.ssaResult!.deadlockReport!.code).toBe('AC3_DOMAIN_EMPTY');
  });
});

// ─── 4. Hopcroft-Karp abort ─────────────────────────────────────
describe('§10.2 Scenario 4 — Hopcroft-Karp abort', () => {
  it('3 sessions competing for 2 exclusive slots → BIPARTITE_MATCHING_INSUFFICIENT', async () => {
    const rooms = [makeRoom(1, 40), makeRoom(2, 40), makeRoom(3, 40)];
    const slots = makeSlots(2);
    const lec = makeLecturer(1);

    const offerings: CourseOffering[] = Array.from({ length: 3 }, (_, i) => {
      const course = makeCourse(i + 1, 1);
      return makeOffering(i + 1, course, rooms[i]!, [lec], 30);
    });

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms, lecturers: [lec], config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('INFEASIBLE');
    expect(result.response.ssaResult!.deadlockReport).toBeDefined();
    expect(result.response.ssaResult!.deadlockReport!.code).toBe('BIPARTITE_MATCHING_INSUFFICIENT');
  });
});

// ─── 5. Partial infeasibility ───────────────────────────────────
describe('§10.2 Scenario 5 — Partial infeasibility', () => {
  it('20 offerings, 2 fail Pre-GA → GA runs on 18 only', async () => {
    const rooms = Array.from({ length: 20 }, (_, i) => makeRoom(i + 1, 40));
    const slots = makeSlots(40);
    const lecturers = Array.from({ length: 20 }, (_, i) =>
      makeLecturer(i + 1, ['general']),
    );

    const offerings: CourseOffering[] = [];
    for (let i = 0; i < 18; i++) {
      const course = makeCourse(i + 1, 1);
      offerings.push(makeOffering(i + 1, course, rooms[i]!, [lecturers[i]!], 30));
    }

    // Infeasible offering 19: no lecturers
    const c19 = makeCourse(19, 1);
    offerings.push(makeOffering(19, c19, rooms[18]!, [], 30));

    // Infeasible offering 20: fixed but no fixedTimeSlotIds
    const c20 = makeCourse(20, 1);
    offerings.push(makeOffering(20, c20, rooms[19]!, [lecturers[19]!], 30, {
      isFixed: true, fixedTimeSlotIds: [],
    }));

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms, lecturers, config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('SUCCESS');
    expect(result.response.preGASummary.infeasible).toHaveLength(2);
    expect(result.response.preGASummary.feasible).toBe(18);
    expect(result.response.gaResult).toBeDefined();
    expect(result.response.gaResult!.bestChromosome).toHaveLength(18);
  });
});

// ─── 6. Parallel class ─────────────────────────────────────────
describe('§10.2 Scenario 6 — Parallel class (capacity split)', () => {
  it('60-student offering, 30-cap room → 2 parallel sessions, both scheduled', async () => {
    const room = makeRoom(1, 30);
    const slots = makeSlots(10);
    const lec = makeLecturer(1);
    const course = makeCourse(1, 1);
    // Fixed offering bypasses the possibleRoomIds qualification check,
    // allowing parallelSessionCount = ceil(60/30) = 2 to take effect.
    // Two fixed slots so each parallel session gets its own slot.
    const offering = makeOffering(1, course, room, [lec], 60, {
      isFixed: true, fixedTimeSlotIds: [1, 2],
    });

    const result = await runPipeline({
      offerings: [offering], timeSlots: slots, rooms: [room], lecturers: [lec],
      config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('SUCCESS');
    expect(result.response.gaResult).toBeDefined();

    const gene = result.response.gaResult!.bestChromosome[0]!;
    // parallelSessionCount = ceil(60 / 30) = 2
    expect(gene.sessions).toHaveLength(2);
    // Both sessions must have valid time slot assignments
    for (const session of gene.sessions) {
      expect(session.timeSlotIds.length).toBeGreaterThan(0);
      expect(session.roomId).toBe(room.id);
    }
  });
});

// ─── 7. Team teaching ───────────────────────────────────────────
describe('§10.2 Scenario 7 — Team teaching', () => {
  it('offering with 2 lecturers → both lecturers blocked at assigned slot', async () => {
    const rooms = [makeRoom(1, 40), makeRoom(2, 40)];
    const slots = makeSlots(10);
    const lec1 = makeLecturer(1);
    const lec2 = makeLecturer(2);

    const courseTeam = makeCourse(1, 1);
    const courseSolo = makeCourse(2, 1);

    const offerings: CourseOffering[] = [
      makeOffering(1, courseTeam, rooms[0]!, [lec1, lec2], 30),
      makeOffering(2, courseSolo, rooms[1]!, [lec1], 30),
    ];

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms, lecturers: [lec1, lec2],
      config: { ...DEFAULT_CONFIG, generations: 100 },
    });

    expect(result.response.status).toBe('SUCCESS');
    expect(result.response.gaResult!.hardViolations).toBe(0);

    const chr = result.response.gaResult!.bestChromosome;
    const teamGene = chr.find(g => g.offeringId === 1)!;
    const soloGene = chr.find(g => g.offeringId === 2)!;

    // The team-taught offering and the solo offering sharing lec1
    // must not overlap in time slots
    const teamSlots = new Set(teamGene.sessions.flatMap(s => s.timeSlotIds));
    const soloSlots = new Set(soloGene.sessions.flatMap(s => s.timeSlotIds));
    for (const slot of teamSlots) {
      expect(soloSlots.has(slot)).toBe(false);
    }
  });
});

// ─── 8. Fixed Room invariant ────────────────────────────────────
describe('§10.2 Scenario 8 — Fixed Room invariant', () => {
  it('5 offerings, 3 locked → locked rooms and slots unchanged in final chromosome', async () => {
    const rooms = [makeRoom(1, 40), makeRoom(2, 40)];
    const slots = makeSlots(20);
    const lecs = Array.from({ length: 5 }, (_, i) => makeLecturer(i + 1));

    const offerings: CourseOffering[] = [
      // 3 fixed offerings
      makeOffering(1, makeCourse(1, 1), rooms[0]!, [lecs[0]!], 30, {
        isFixed: true, fixedTimeSlotIds: [1],
      }),
      makeOffering(2, makeCourse(2, 1), rooms[0]!, [lecs[1]!], 30, {
        isFixed: true, fixedTimeSlotIds: [2],
      }),
      makeOffering(3, makeCourse(3, 1), rooms[1]!, [lecs[2]!], 30, {
        isFixed: true, fixedTimeSlotIds: [3],
      }),
      // 2 flexible offerings
      makeOffering(4, makeCourse(4, 1), rooms[0]!, [lecs[3]!], 30),
      makeOffering(5, makeCourse(5, 1), rooms[1]!, [lecs[4]!], 30),
    ];

    const result = await runPipeline({
      offerings, timeSlots: slots, rooms, lecturers: lecs, config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('SUCCESS');
    const chr = result.response.gaResult!.bestChromosome;

    // Verify each fixed offering retains its locked room and slot
    for (const fixedOffering of offerings.filter(o => o.isFixed)) {
      const gene = chr.find(g => g.offeringId === fixedOffering.id)!;
      expect(gene.kind).toBe('FIXED');
      for (const session of gene.sessions) {
        expect(session.roomId).toBe(fixedOffering.roomId);
      }
      // Fixed time slots must be preserved
      const assignedSlots = gene.sessions.flatMap(s => s.timeSlotIds);
      for (const slot of fixedOffering.fixedTimeSlotIds!) {
        expect(assignedSlots).toContain(slot);
      }
    }
  });
});

// ─── 9. Competency mismatch (Pre-GA) ───────────────────────────
describe('§10.2 Scenario 9 — Competency mismatch (Pre-GA)', () => {
  it('lecturer with no competency overlap → Pre-GA rejects with COMPETENCY_MISMATCH', async () => {
    const room = makeRoom(1, 40);
    const slots = makeSlots(10);
    const lec = makeLecturer(1, ['databases']);
    const course = makeCourse(1, 1, [], ['ai-ml']);
    const offering = makeOffering(1, course, room, [lec], 30);

    const result = await runPipeline({
      offerings: [offering], timeSlots: slots, rooms: [room], lecturers: [lec],
      config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('NO_FEASIBLE_CANDIDATES');
    expect(result.response.preGASummary.infeasible).toHaveLength(1);
    expect(result.response.preGASummary.infeasible[0]!.code).toBe('COMPETENCY_MISMATCH');
    expect(result.response.preGASummary.infeasible[0]!.offeringId).toBe(1);
  });
});

// ─── 10. Competency open assignment ─────────────────────────────
describe('§10.2 Scenario 10 — Competency open assignment', () => {
  it('requiredCompetencies = [] → Pre-GA passes regardless of lecturer competencies', async () => {
    const room = makeRoom(1, 40);
    const slots = makeSlots(10);
    const lec = makeLecturer(1, ['anything']);
    const course = makeCourse(1, 1, [], []);
    const offering = makeOffering(1, course, room, [lec], 30);

    const result = await runPipeline({
      offerings: [offering], timeSlots: slots, rooms: [room], lecturers: [lec],
      config: DEFAULT_CONFIG,
    });

    expect(result.response.status).toBe('SUCCESS');
    expect(result.response.preGASummary.infeasible).toHaveLength(0);
    expect(result.response.gaResult!.hardViolations).toBe(0);
  });
});

// ─── 11. Crossover comparison ───────────────────────────────────
describe('§10.2 Scenario 11 — Crossover comparison', () => {
  function buildComparisonDataset(): OrchestratorInput {
    const rooms = Array.from({ length: 5 }, (_, i) => makeRoom(i + 1, 40));
    const slots = makeSlots(15);
    const lecturers = Array.from({ length: 8 }, (_, i) =>
      makeLecturer(i + 1, ['general']),
    );

    const offerings: CourseOffering[] = [];
    for (let i = 0; i < 8; i++) {
      const course = makeCourse(i + 1, 1);
      offerings.push(
        makeOffering(i + 1, course, rooms[i % 5]!, [lecturers[i]!], 30),
      );
    }

    return {
      offerings,
      timeSlots: slots,
      rooms,
      lecturers,
      config: { ...DEFAULT_CONFIG, generations: 80 },
    };
  }

  const strategies: Array<'singlePoint' | 'uniform' | 'pmx'> = [
    'singlePoint',
    'uniform',
    'pmx',
  ];

  for (const strategy of strategies) {
    it(`${strategy} produces a valid result with a fitness history`, async () => {
      const input = buildComparisonDataset();
      input.config = { ...input.config, crossoverType: strategy };

      const result = await runPipeline(input);

      expect(result.response.status).toBe('SUCCESS');
      expect(result.response.gaResult).toBeDefined();
      expect(result.response.gaResult!.history.length).toBeGreaterThan(0);
      expect(result.response.gaResult!.bestFitness).toBeGreaterThan(0);
    });
  }

  it('all three strategies produce monotonically non-decreasing fitness histories', async () => {
    const histories: Record<string, number[]> = {};

    for (const strategy of strategies) {
      const input = buildComparisonDataset();
      input.config = { ...input.config, crossoverType: strategy };

      const result = await runPipeline(input);
      expect(result.response.status).toBe('SUCCESS');
      histories[strategy] = result.response.gaResult!.history;

      // Elitism guarantees monotonicity
      const h = histories[strategy]!;
      const EPS = 1e-12;
      for (let i = 1; i < h.length; i++) {
        expect(
          h[i]! + EPS >= h[i - 1]!,
          `${strategy}: history[${i}]=${h[i]} dropped below history[${i - 1}]=${h[i - 1]}`,
        ).toBe(true);
      }
    }

    // All three strategies ran to completion
    expect(Object.keys(histories)).toHaveLength(3);
  });
});
