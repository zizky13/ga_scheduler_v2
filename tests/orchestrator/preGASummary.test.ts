/**
 * Orchestrator — preGASummary.infeasible[] payload shape
 *
 * Covers Phase 2 / Task 7 (backlog.md line 46) and api_design §5.2:
 *
 *   `COMPETENCY_MISMATCH` is per-offering (Pre-GA `checkCompetencies`),
 *   not a top-level run failure. It surfaces inside
 *   `preGASummary.infeasible[]` as `{offeringId, code, message}`. The run
 *   only escalates to top-level `NO_FEASIBLE_CANDIDATES` when **every**
 *   offering is rejected (whether for `COMPETENCY_MISMATCH` or any other
 *   Layer 1 reason). A run with some rejected and some feasible offerings
 *   still proceeds through SSA → GA on the feasible subset.
 *
 * Three scenarios:
 *   1. Mixed             — some pass, some COMPETENCY_MISMATCH → SUCCESS,
 *                          GA runs on the feasible subset.
 *   2. All-rejected      — every offering fails COMPETENCY_MISMATCH →
 *                          NO_FEASIBLE_CANDIDATES, infeasible[] populated.
 *   3. Mixed-reason      — non-COMPETENCY codes (FACILITY_MISMATCH,
 *                          NO_ROOMS_QUALIFY) also surface in the array.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  CourseOffering,
  GAConfig,
  Lecturer,
  Room,
  TimeSlot,
} from '../../src/types.js';
import { runPipeline } from '../../src/orchestrator.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Shared fixture builders ────────────────────────────────────
function buildBaseConfig(): GAConfig {
  return {
    populationSize: 20,
    generations: 20,
    mutationRate: 0.1,
    elitismCount: 2,
    tournamentSize: 3,
    crossoverType: 'singlePoint',
    noiseRate: 0.15,
    hardPenaltyWeight: 100,
    softPenaltyWeight: 1,
  };
}

function buildRooms(): Room[] {
  return [
    { id: 1, name: 'R-101', capacity: 40, facilities: ['PROJECTOR'] },
    { id: 2, name: 'R-102', capacity: 40, facilities: ['PROJECTOR'] },
    { id: 3, name: 'LAB-A', capacity: 30, facilities: ['LAB', 'PROJECTOR'] },
  ];
}

function buildTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const times = [
    { start: '08:00', end: '10:00' },
    { start: '10:00', end: '12:00' },
    { start: '13:00', end: '15:00' },
  ];
  let id = 1;
  for (const day of days) {
    for (const t of times) {
      slots.push({ id: id++, day, startTime: t.start, endTime: t.end });
    }
  }
  return slots;
}

function buildLecturers(): Lecturer[] {
  return [
    {
      id: 1, name: 'Lec Algorithms', isStructural: false, maxSks: 12,
      preferredTimeSlotIds: [], competencies: ['algorithms'],
    },
    {
      id: 2, name: 'Lec Databases', isStructural: false, maxSks: 12,
      preferredTimeSlotIds: [], competencies: ['databases'],
    },
    {
      id: 3, name: 'Lec Networks', isStructural: false, maxSks: 12,
      preferredTimeSlotIds: [], competencies: ['networks'],
    },
    {
      id: 4, name: 'Lec NoCompetencies', isStructural: false, maxSks: 12,
      preferredTimeSlotIds: [], competencies: [],
    },
  ];
}

// ─── 1. Mixed scenario: some pass, some COMPETENCY_MISMATCH ──────
describe('orchestrator preGASummary — COMPETENCY_MISMATCH is per-offering, not per-run', () => {
  it('mixed: some offerings pass, others fail COMPETENCY_MISMATCH → SUCCESS with infeasible[] populated and GA runs on feasible subset', async () => {
    const rooms = buildRooms();
    const timeSlots = buildTimeSlots();
    const lecturers = buildLecturers();

    // Offering 1: PASS — algorithms course, lecturer with 'algorithms' competency
    // Offering 2: FAIL COMPETENCY_MISMATCH — databases course, but lecturer has only 'algorithms'
    // Offering 3: PASS — networks course, lecturer with 'networks' competency
    const offerings: CourseOffering[] = [
      {
        id: 1, courseId: 1,
        course: {
          id: 1, code: 'IF101', name: 'Algoritma',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['algorithms'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[0]!], // Lec Algorithms
        effectiveStudentCount: 30, isFixed: false,
      },
      {
        id: 2, courseId: 2,
        course: {
          id: 2, code: 'IF201', name: 'Basis Data',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['databases'],
        },
        roomId: 2, room: rooms[1]!,
        lecturers: [lecturers[0]!], // Lec Algorithms — competency MISMATCH
        effectiveStudentCount: 30, isFixed: false,
      },
      {
        id: 3, courseId: 3,
        course: {
          id: 3, code: 'IF202', name: 'Jaringan Komputer',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['networks'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[2]!], // Lec Networks
        effectiveStudentCount: 30, isFixed: false,
      },
    ];

    const { response } = await runPipeline({
      offerings, timeSlots, rooms, lecturers, config: buildBaseConfig(),
    });

    // Per §5.2: COMPETENCY_MISMATCH is per-offering, not per-run.
    expect(response.status).toBe('SUCCESS');
    expect(response.preGASummary.feasible).toBe(2);
    expect(Array.isArray(response.preGASummary.infeasible)).toBe(true);
    expect(response.preGASummary.infeasible).toHaveLength(1);

    const entry = response.preGASummary.infeasible[0]!;
    expect(entry.offeringId).toBe(2);
    expect(entry.code).toBe('COMPETENCY_MISMATCH');
    expect(entry.message).toContain('competencies');

    // GA must have actually run on the feasible subset.
    expect(response.gaResult).toBeDefined();
    expect(response.gaResult!.bestChromosome).toHaveLength(2);
    const offeringIds = response.gaResult!.bestChromosome
      .map(g => g.offeringId).sort();
    expect(offeringIds).toEqual([1, 3]);
  });
});

// ─── 2. All-rejected scenario ───────────────────────────────────
describe('orchestrator preGASummary — NO_FEASIBLE_CANDIDATES only when every offering is rejected', () => {
  it('all offerings fail COMPETENCY_MISMATCH → NO_FEASIBLE_CANDIDATES with infeasible[] containing every entry', async () => {
    const rooms = buildRooms();
    const timeSlots = buildTimeSlots();
    const lecturers = buildLecturers();

    // All three offerings paired with a lecturer whose competencies do not
    // intersect requiredCompetencies → all rejected with COMPETENCY_MISMATCH.
    const offerings: CourseOffering[] = [
      {
        id: 1, courseId: 1,
        course: {
          id: 1, code: 'IF101', name: 'Algoritma',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['algorithms'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[1]!], // Lec Databases — MISMATCH
        effectiveStudentCount: 30, isFixed: false,
      },
      {
        id: 2, courseId: 2,
        course: {
          id: 2, code: 'IF201', name: 'Basis Data',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['databases'],
        },
        roomId: 2, room: rooms[1]!,
        lecturers: [lecturers[2]!], // Lec Networks — MISMATCH
        effectiveStudentCount: 30, isFixed: false,
      },
      {
        id: 3, courseId: 3,
        course: {
          id: 3, code: 'IF202', name: 'Jaringan Komputer',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['networks'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[0]!], // Lec Algorithms — MISMATCH
        effectiveStudentCount: 30, isFixed: false,
      },
    ];

    const { response } = await runPipeline({
      offerings, timeSlots, rooms, lecturers, config: buildBaseConfig(),
    });

    expect(response.status).toBe('NO_FEASIBLE_CANDIDATES');
    expect(response.preGASummary.feasible).toBe(0);
    expect(response.preGASummary.infeasible).toHaveLength(3);

    // Every entry must be COMPETENCY_MISMATCH and reference a known offering.
    const codes = response.preGASummary.infeasible.map(e => e.code);
    expect(codes.every(c => c === 'COMPETENCY_MISMATCH')).toBe(true);
    const offeringIds = response.preGASummary.infeasible
      .map(e => e.offeringId).sort();
    expect(offeringIds).toEqual([1, 2, 3]);

    // No GA / SSA result when there are no feasible candidates.
    expect(response.gaResult).toBeUndefined();
    expect(response.ssaResult).toBeUndefined();
  });
});

// ─── 3. Mixed-reason scenario (non-COMPETENCY codes appear too) ─
describe('orchestrator preGASummary — non-COMPETENCY Layer 1 codes also surface in infeasible[]', () => {
  it('FACILITY_MISMATCH, COMPETENCY_MISMATCH, and NO_ROOMS_QUALIFY all surface as per-offering entries', async () => {
    const rooms = buildRooms();
    const timeSlots = buildTimeSlots();
    const lecturers = buildLecturers();

    const offerings: CourseOffering[] = [
      // Offering 1: PASS
      {
        id: 1, courseId: 1,
        course: {
          id: 1, code: 'IF101', name: 'Algoritma',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['algorithms'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[0]!],
        effectiveStudentCount: 30, isFixed: false,
      },
      // Offering 2: FACILITY_MISMATCH — LAB course assigned to a room without LAB.
      {
        id: 2, courseId: 2,
        course: {
          id: 2, code: 'IF301', name: 'OS Lab',
          sks: 3, requiredFacilities: ['LAB'], requiredCompetencies: ['algorithms'],
        },
        roomId: 1, room: rooms[0]!, // R-101 has only PROJECTOR
        lecturers: [lecturers[0]!],
        effectiveStudentCount: 25, isFixed: false,
      },
      // Offering 3: COMPETENCY_MISMATCH — databases course w/ algorithms lecturer.
      {
        id: 3, courseId: 3,
        course: {
          id: 3, code: 'IF201', name: 'Basis Data',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['databases'],
        },
        roomId: 2, room: rooms[1]!,
        lecturers: [lecturers[0]!],
        effectiveStudentCount: 30, isFixed: false,
      },
      // Offering 4: NO_ROOMS_QUALIFY — Flexible offering with student count
      // greater than ANY room's capacity (max 40 in this fixture). The
      // assigned room (R-101 cap=40) still passes the per-offering room /
      // capacity / temporal / facility checks (requiredSessions=⌈50/40⌉=2
      // ≤ 15 slots, no required facilities) — so we land in the validator's
      // global "no qualifying room" branch (capacity >= effectiveStudentCount
      // is the gate).
      {
        id: 4, courseId: 4,
        course: {
          id: 4, code: 'IF202', name: 'Jaringan Komputer (Mass Lecture)',
          sks: 3, requiredFacilities: [], requiredCompetencies: ['networks'],
        },
        roomId: 1, room: rooms[0]!,
        lecturers: [lecturers[2]!],
        effectiveStudentCount: 50, isFixed: false,
      },
    ];

    const { response } = await runPipeline({
      offerings, timeSlots, rooms, lecturers, config: buildBaseConfig(),
    });

    expect(response.status).toBe('SUCCESS'); // offering 1 is feasible
    expect(response.preGASummary.feasible).toBe(1);
    expect(response.preGASummary.infeasible).toHaveLength(3);

    const codesByOffering = new Map(
      response.preGASummary.infeasible.map(e => [e.offeringId, e.code])
    );
    expect(codesByOffering.get(2)).toBe('FACILITY_MISMATCH');
    expect(codesByOffering.get(3)).toBe('COMPETENCY_MISMATCH');
    expect(codesByOffering.get(4)).toBe('NO_ROOMS_QUALIFY');

    // Each entry carries a non-empty human-readable message.
    for (const entry of response.preGASummary.infeasible) {
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });
});
