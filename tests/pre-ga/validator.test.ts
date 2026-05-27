/**
 * Regression tests for `runPreGA` (src/pre-ga/validator.ts).
 *
 * Phase 10 #5: an offering with `isFixed: true, roomId: null,
 * fixedTimeSlotIds: [...]` represents the "fixed time, flexible room" shape
 * — the advisor pinned the time but did NOT lock a room. Phase 7 made
 * `CourseOffering.roomId` nullable, but the validator's `lockedRoomMap`
 * filter and `possibleRoomIds` computation both used to assume room and
 * time-fixedness were coupled. Tasks #1 and #5 separate them: the candidate
 * must arrive at the GA as `isFixedRoom: false` with `possibleRoomIds`
 * populated, so the chromosome seeder can pick a room from the pool.
 */

import { describe, it, expect } from 'vitest';
import { runPreGA } from '../../src/pre-ga/validator.js';
import type { CourseOffering, Course, Lecturer, Room, TimeSlot } from '../../src/types.js';

// ─── Fixture helpers ─────────────────────────────────────────────

function buildRoom(id: number, capacity = 30): Room {
  return {
    id,
    name: `R-${id}`,
    capacity,
    facilities: [],
  };
}

function buildCourse(): Course {
  return {
    id: 10,
    code: 'CS101',
    name: 'Algorithms',
    sks: 1,
    requiredFacilities: [],
    requiredCompetencies: [],
  };
}

function buildLecturer(): Lecturer {
  return {
    id: 100,
    name: 'Dr. Test',
    competencies: [],
    isStructural: false,
    preferredTimeSlotIds: [],
    maxSks: 12,
  };
}

function buildTimeSlots(n: number): TimeSlot[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    day: 'Mon',
    startTime: `${8 + i}:00`,
    endTime: `${9 + i}:00`,
  }));
}

describe('runPreGA — Phase 10 fixed-time / flexible-room candidates', () => {
  it('emits an isFixed=true, roomId=null offering as a FLEXIBLE candidate with possibleRoomIds', () => {
    const rooms = [buildRoom(1, 30), buildRoom(2, 30), buildRoom(3, 30)];
    const timeSlots = buildTimeSlots(5);
    const offering: CourseOffering = {
      id: 1,
      courseId: 10,
      course: buildCourse(),
      roomId: null, // ← Phase 7: no chosen / locked room
      room: rooms[0]!, // checkIntegrity reads the relation; production has both
                       //   null in lockstep, but the unit-test fixture provides
                       //   a Room so the test exercises the lockedRoomMap and
                       //   possibleRoomIds branches in isolation.
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: true, // ← time pinned
      fixedTimeSlotIds: [1], // ← single fixed slot, sks = 1
    };

    const { validation, candidates } = runPreGA([offering], timeSlots, rooms);

    // The offering must pass pre-GA — it's the "fixed time, flexible room" case.
    expect(validation.infeasible).toEqual([]);
    expect(validation.feasible).toHaveLength(1);
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0]!;

    // (a) The candidate must NOT be marked isFixedRoom (no LockedRoom exists,
    //     and validator.ts:131 strips null-roomId entries from lockedRoomMap).
    expect(candidate.isFixedRoom).toBe(false);

    // The candidate's roomId stays null — the chromosome seeder will pick.
    expect(candidate.roomId).toBeNull();

    // (b) possibleRoomIds must be populated so the chromosome seeder has a pool
    //     to pick from. All three test rooms satisfy capacity ≥ 20 with no
    //     facility constraints.
    expect(candidate.possibleRoomIds).toBeDefined();
    expect(candidate.possibleRoomIds).toEqual(expect.arrayContaining([1, 2, 3]));

    // (c) Indirect verification that lockedRoomMap does NOT contain this
    //     offering: lockedRoomMap is internal to runPreGA, but if it did
    //     contain the entry, entityTagger would have stamped isFixedRoom=true.
    //     Assertion (a) covers this.
  });

  it('still emits a locked offering (isFixed=true, roomId=number) as FIXED with the locked room', () => {
    const rooms = [buildRoom(1, 30), buildRoom(7, 30)];
    const timeSlots = buildTimeSlots(5);
    const offering: CourseOffering = {
      id: 2,
      courseId: 10,
      course: buildCourse(),
      roomId: 7, // ← locked room (legacy in-process proxy for LockedRoom)
      room: rooms[1]!,
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: true,
      fixedTimeSlotIds: [1],
    };

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.isFixedRoom).toBe(true);
    expect(candidates[0]!.roomId).toBe(7);
  });

  it('still emits a flexible offering (isFixed=false, roomId=null) as FLEXIBLE with possibleRoomIds', () => {
    // Regression guard: ensure the Phase 7 path (the canonical "new offering
    // without a chosen room") keeps working alongside the new fixed-time case.
    const rooms = [buildRoom(1, 30), buildRoom(2, 30)];
    const timeSlots = buildTimeSlots(5);
    const offering: CourseOffering = {
      id: 3,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: rooms[0]!,
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: false,
    };

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.isFixedRoom).toBe(false);
    expect(candidates[0]!.roomId).toBeNull();
    expect(candidates[0]!.possibleRoomIds).toEqual(expect.arrayContaining([1, 2]));
  });
});

describe('runPreGA — Phase 11 null-room overflow parallel split', () => {
  it('null-room offering with capacity overflow yields parallelSessionCount and a facility-only possibleRoomIds pool', () => {
    // Phase 11 tasks #1 + #2: 90 students, 3 rooms each cap 40. No single room
    // fits, so the loose facility-only filter applies and the validator
    // computes parallelSessionCount from the largest qualifying room
    // (⌈90 / 40⌉ = 3). possibleRoomIds must include all three rooms — the
    // capacity gate is dropped for null-room offerings.
    const rooms = [buildRoom(1, 40), buildRoom(2, 40), buildRoom(3, 40)];
    const timeSlots = buildTimeSlots(5);
    const offering: CourseOffering = {
      id: 10,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: null, // genuinely null — forces the validator's null-room path
      lecturers: [buildLecturer()],
      effectiveStudentCount: 90,
      isFixed: false,
    };

    const { validation, candidates } = runPreGA([offering], timeSlots, rooms);

    expect(validation.infeasible).toEqual([]);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.parallelSessionCount).toBe(3);
    expect(candidate.possibleRoomIds).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(candidate.possibleRoomIds).toHaveLength(3);
  });

  it('rejects null-room offerings whose required parallel count exceeds MAX_PARALLEL_SESSIONS × maxQualifyingCapacity', () => {
    // Phase 11 task #2: 5 rooms each cap 20 → maxQualifyingCapacity = 20.
    // 110 students → required = ⌈110/20⌉ = 6. The data-driven cap is
    // min(MAX_PARALLEL_SESSIONS_HARD_CAP=5, |possibleRoomIds|=5) = 5.
    // 6 > 5 → rejection code NO_CAPACITY_COMBINATION.
    const rooms = [
      buildRoom(1, 20),
      buildRoom(2, 20),
      buildRoom(3, 20),
      buildRoom(4, 20),
      buildRoom(5, 20),
    ];
    const timeSlots = buildTimeSlots(10);
    const offering: CourseOffering = {
      id: 11,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: null,
      lecturers: [buildLecturer()],
      effectiveStudentCount: 110,
      isFixed: false,
    };

    const { validation, candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toEqual([]);
    expect(validation.feasible).toEqual([]);
    expect(validation.infeasible).toHaveLength(1);
    expect(validation.infeasible[0]!.failedCheck.code).toBe('NO_CAPACITY_COMBINATION');
    expect(validation.infeasible[0]!.offering.id).toBe(11);
  });
});

describe('runPreGA — Phase 15 #1 cohort aggregation (OQ-22 / OQ-23)', () => {
  it('aggregates two same-course offerings into one cohort candidate with siblingOfferingIds.length === 2', () => {
    // Two offerings sharing courseId=10 but with different lecturers and
    // disagreeing effectiveStudentCount (40 vs 60). Per OQ-22 they form ONE
    // cohort; per OQ-23 the cohort's effectiveStudentCount = max(siblings).
    const rooms = [buildRoom(1, 80), buildRoom(2, 80)];
    const timeSlots = buildTimeSlots(5);
    const lecturerA: Lecturer = { ...buildLecturer(), id: 200 };
    const lecturerB: Lecturer = { ...buildLecturer(), id: 201 };
    const offeringPrimary: CourseOffering = {
      id: 5,
      courseId: 10,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerA],
      effectiveStudentCount: 40,
      isFixed: false,
    };
    const offeringSibling: CourseOffering = {
      id: 7,
      courseId: 10,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerB],
      effectiveStudentCount: 60,
      isFixed: false,
    };

    const { validation, candidates } = runPreGA(
      [offeringSibling, offeringPrimary], // intentionally out of id order
      timeSlots,
      rooms,
    );

    expect(validation.infeasible).toEqual([]);
    expect(validation.feasible).toHaveLength(2);
    // ONE candidate per cohort, NOT one per offering.
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0]!;
    // Primary = lowest-id sibling (id=5).
    expect(candidate.offeringId).toBe(5);
    expect(candidate.courseId).toBe(10);
    expect(candidate.siblingOfferingIds).toEqual([5, 7]);
    // OQ-23 default: max(40, 60) = 60.
    expect(candidate.effectiveStudentCount).toBe(60);
    // `lecturerIds` keeps primary-only semantics for SSA back-compat.
    expect(candidate.lecturerIds).toEqual([200]);
    // Phase 15 #2: `lecturerPool` is the union of every sibling's lecturer
    // ids, deduplicated and sorted ascending. Disjoint sets here → [200, 201].
    expect(candidate.lecturerPool).toEqual([200, 201]);
    // parallelSessionCount = ⌈60 / 80⌉ = 1 (primary.room.capacity).
    expect(candidate.parallelSessionCount).toBe(1);
  });

  it('Phase 15 #2: lecturerPool deduplicates lecturers shared across siblings and sorts ascending', () => {
    // Two siblings whose lecturer sets overlap on one shared id; the cohort's
    // `lecturerPool` must collapse the duplicate and emit a sorted union.
    // Picks shuffled ids so the ascending sort is observably load-bearing.
    const rooms = [buildRoom(1, 80)];
    const timeSlots = buildTimeSlots(5);
    const lecturerA: Lecturer = { ...buildLecturer(), id: 305 };
    const lecturerB: Lecturer = { ...buildLecturer(), id: 110 };
    const lecturerC: Lecturer = { ...buildLecturer(), id: 220 };
    const offeringPrimary: CourseOffering = {
      id: 12,
      courseId: 99,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerA, lecturerB], // [305, 110]
      effectiveStudentCount: 30,
      isFixed: false,
    };
    const offeringSibling: CourseOffering = {
      id: 18,
      courseId: 99,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerB, lecturerC], // [110, 220] — 110 overlaps
      effectiveStudentCount: 30,
      isFixed: false,
    };

    const { candidates } = runPreGA(
      [offeringPrimary, offeringSibling],
      timeSlots,
      rooms,
    );

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.siblingOfferingIds).toEqual([12, 18]);
    // Primary-only lecturerIds — preserves insertion order from primary.
    expect(candidate.lecturerIds).toEqual([305, 110]);
    // Union {305, 110, 220} → dedup'd, ascending → [110, 220, 305].
    expect(candidate.lecturerPool).toEqual([110, 220, 305]);
  });

  it('single-offering cohort emits a candidate structurally identical to today, with siblingOfferingIds = [offeringId]', () => {
    // Backward-compatibility guard: the legacy "every fixture pre-Phase-15"
    // shape must remain byte-identical aside from the new siblingOfferingIds.
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildTimeSlots(5);
    const offering: CourseOffering = {
      id: 42,
      courseId: 10,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: false,
    };

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.offeringId).toBe(42);
    expect(candidates[0]!.siblingOfferingIds).toEqual([42]);
    // parallelSessionCount unchanged from pre-Phase-15: ⌈20/30⌉ = 1.
    expect(candidates[0]!.parallelSessionCount).toBe(1);
    expect(candidates[0]!.effectiveStudentCount).toBe(20);
  });

  // Phase 15 task #4 case (c) — "single-offering cohort of one" — is covered
  // by the test above ("single-offering cohort emits a candidate structurally
  // identical to today..."). The two `it` blocks below cover cases (a) and (b).

  it('Phase 15 #4(a): two same-course offerings at 97 students each yield one cohort candidate with parallelSessionCount = 4 (NOT 8)', () => {
    // User's reported bug case (Phase 15 motivating example): 97 students +
    // room cap 30 → 4 sessions distributed across siblings, not 4 per sibling
    // = 8 total. Asserts the cohort aggregation produces ONE candidate whose
    // parallelSessionCount reflects the unified student count, NOT the sum of
    // per-offering session counts.
    const rooms = [
      buildRoom(1, 30),
      buildRoom(2, 30),
      buildRoom(3, 30),
      buildRoom(4, 30),
      buildRoom(5, 30),
    ];
    const timeSlots = buildTimeSlots(8);
    const lecturerA: Lecturer = { ...buildLecturer(), id: 400 };
    const lecturerB: Lecturer = { ...buildLecturer(), id: 401 };
    const offeringPrimary: CourseOffering = {
      id: 50,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: null, // null-room overflow path (Phase 11)
      lecturers: [lecturerA],
      effectiveStudentCount: 97,
      isFixed: false,
    };
    const offeringSibling: CourseOffering = {
      id: 51,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: null,
      lecturers: [lecturerB],
      effectiveStudentCount: 97,
      isFixed: false,
    };

    const { validation, candidates } = runPreGA(
      [offeringPrimary, offeringSibling],
      timeSlots,
      rooms,
    );

    expect(validation.infeasible).toEqual([]);
    // ONE candidate per cohort, NOT two.
    expect(candidates).toHaveLength(1);

    const candidate = candidates[0]!;
    expect(candidate.siblingOfferingIds).toHaveLength(2);
    expect(candidate.siblingOfferingIds).toEqual([50, 51]);
    // OQ-23 default with max-of-equals: max(97, 97) = 97.
    expect(candidate.effectiveStudentCount).toBe(97);
    // Load-bearing assertion: ⌈97 / 30⌉ = 4, NOT 4 + 4 = 8.
    expect(candidate.parallelSessionCount).toBe(4);
    // Union of disjoint singleton lecturer sets → [400, 401].
    expect(candidate.lecturerPool).toEqual([400, 401]);
    // Null-room overflow path (Phase 11): all 5 rooms qualify on facilities.
    expect(candidate.possibleRoomIds).toBeDefined();
    expect(candidate.possibleRoomIds).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    expect(candidate.possibleRoomIds).toHaveLength(5);
  });

  it('Phase 15 #4(b): siblings disagreeing on effectiveStudentCount resolve to max per OQ-23 default', () => {
    // OQ-23 default (b) `max(siblings)`: with 50 vs 100, the cohort's
    // effectiveStudentCount must be 100 — NOT 50 (min), NOT 150 (sum), NOT 75
    // (mean). Room capacity is intentionally large (200) so parallelSessionCount
    // collapses to 1 and this test focuses on the max-aggregation rule in
    // isolation. Flip-point: if OQ-23 is ever switched to (a) min, (c) mean, or
    // (d) reject, grep for "OQ-23" here to find this regression guard.
    const rooms = [buildRoom(1, 200)];
    const timeSlots = buildTimeSlots(5);
    const lecturerA: Lecturer = { ...buildLecturer(), id: 500 };
    const lecturerB: Lecturer = { ...buildLecturer(), id: 501 };
    const offeringPrimary: CourseOffering = {
      id: 60,
      courseId: 10,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerA],
      effectiveStudentCount: 50,
      isFixed: false,
    };
    const offeringSibling: CourseOffering = {
      id: 61,
      courseId: 10,
      course: buildCourse(),
      roomId: 1,
      room: rooms[0]!,
      lecturers: [lecturerB],
      effectiveStudentCount: 100,
      isFixed: false,
    };

    const { validation, candidates } = runPreGA(
      [offeringPrimary, offeringSibling],
      timeSlots,
      rooms,
    );

    expect(validation.infeasible).toEqual([]);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.siblingOfferingIds).toHaveLength(2);
    expect(candidate.siblingOfferingIds).toEqual([60, 61]);
    // OQ-23 default (b): max(50, 100) = 100.
    expect(candidate.effectiveStudentCount).toBe(100);
  });
});

describe('runPreGA — Phase 14 #6 mappingDefects rejection', () => {
  // Inline helper that builds a clean offering and lets the caller overlay
  // mappingDefects / room / roomId fields. Kept local to this describe so the
  // existing buildRoom/buildCourse/buildLecturer/buildTimeSlots helpers above
  // remain untouched (task constraint: additive only).
  function buildOffering(overrides: Partial<CourseOffering> = {}): CourseOffering {
    return {
      id: 1,
      courseId: 10,
      course: buildCourse(),
      roomId: null,
      room: buildRoom(1, 30),
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: false,
      ...overrides,
    };
  }

  it('rejects an offering with missingLecturerIds while a clean sibling proceeds', () => {
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildTimeSlots(5);

    const clean = buildOffering({ id: 100 });
    const defective = buildOffering({
      id: 200,
      mappingDefects: { missingLecturerIds: [999] },
    });

    let result: ReturnType<typeof runPreGA> | undefined;
    expect(() => {
      result = runPreGA([clean, defective], timeSlots, rooms);
    }).not.toThrow();

    const { validation, candidates } = result!;

    // Clean offering proceeds; defective offering is rejected.
    expect(validation.feasible).toHaveLength(1);
    expect(validation.feasible[0]!.id).toBe(100);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.offeringId).toBe(100);

    expect(validation.infeasible).toHaveLength(1);
    const entry = validation.infeasible[0]!;
    expect(entry.offering.id).toBe(200);
    expect(entry.failedCheck.code).toBe('CROSS_SEMESTER_DEFECT');

    // Metadata envelope (matches src/pre-ga/checks.ts:checkIntegrity).
    const metadata = entry.failedCheck.metadata as {
      field: 'lecturerIds' | 'roomId';
      expectedSemesterId?: number;
      mismatches: Array<{ id: number; actualSemesterId?: number }>;
      fields: Array<{
        field: 'lecturerIds' | 'roomId';
        expectedSemesterId?: number;
        mismatches: Array<{ id: number; actualSemesterId?: number }>;
      }>;
    };
    expect(metadata.field).toBe('lecturerIds');
    expect(metadata.mismatches).toEqual([{ id: 999 }]);
    expect(metadata.fields).toHaveLength(1);
    expect(metadata.fields[0]!.field).toBe('lecturerIds');
    expect(metadata.fields[0]!.mismatches).toEqual([{ id: 999 }]);
  });

  it('rejects an offering with missingRoomId and surfaces the roomId envelope', () => {
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildTimeSlots(5);

    const offering = buildOffering({
      id: 300,
      roomId: null,
      room: null,
      mappingDefects: { missingRoomId: 42 },
    });

    const { validation, candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toEqual([]);
    expect(validation.feasible).toEqual([]);
    expect(validation.infeasible).toHaveLength(1);

    const entry = validation.infeasible[0]!;
    expect(entry.offering.id).toBe(300);
    expect(entry.failedCheck.code).toBe('CROSS_SEMESTER_DEFECT');

    const metadata = entry.failedCheck.metadata as {
      field: 'lecturerIds' | 'roomId';
      mismatches: Array<{ id: number }>;
      fields: Array<{ field: 'lecturerIds' | 'roomId'; mismatches: Array<{ id: number }> }>;
    };
    expect(metadata.field).toBe('roomId');
    expect(metadata.mismatches).toEqual([{ id: 42 }]);
    expect(metadata.fields).toHaveLength(1);
    expect(metadata.fields[0]!.field).toBe('roomId');
    expect(metadata.fields[0]!.mismatches).toEqual([{ id: 42 }]);
  });

  it('surfaces both lecturer and room defects together in metadata.fields', () => {
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildTimeSlots(5);

    const offering = buildOffering({
      id: 400,
      roomId: null,
      room: null,
      mappingDefects: {
        missingLecturerIds: [999],
        missingRoomId: 42,
      },
    });

    const { validation } = runPreGA([offering], timeSlots, rooms);

    expect(validation.infeasible).toHaveLength(1);
    const entry = validation.infeasible[0]!;
    expect(entry.failedCheck.code).toBe('CROSS_SEMESTER_DEFECT');

    const metadata = entry.failedCheck.metadata as {
      field: 'lecturerIds' | 'roomId';
      mismatches: Array<{ id: number }>;
      fields: Array<{ field: 'lecturerIds' | 'roomId'; mismatches: Array<{ id: number }> }>;
    };

    // checkIntegrity pushes the lecturer group first, then room — the top-level
    // `field` / `mismatches` mirrors groups[0] (lecturerIds).
    expect(metadata.field).toBe('lecturerIds');
    expect(metadata.mismatches).toEqual([{ id: 999 }]);

    // Both groups are surfaced in `fields[]`, in lecturer-then-room order.
    expect(metadata.fields).toHaveLength(2);
    expect(metadata.fields[0]!.field).toBe('lecturerIds');
    expect(metadata.fields[0]!.mismatches).toEqual([{ id: 999 }]);
    expect(metadata.fields[1]!.field).toBe('roomId');
    expect(metadata.fields[1]!.mismatches).toEqual([{ id: 42 }]);
  });
});

describe('runPreGA — Phase 16 #1 longestContiguousRun derivation (OQ-32 / OQ-33)', () => {
  // Custom timeslot builder — the default `buildTimeSlots` produces a single
  // strictly-contiguous Monday block, which can't exercise per-day grouping
  // or in-day gaps. Each block represents one day's slot list; gaps between
  // adjacent entries (where `prev.endTime !== next.startTime`) terminate the
  // current run, matching the OQ-32 strict-equality contract.
  function buildSlotsFromBlocks(
    blocks: Array<{ day: string; times: Array<{ start: string; end: string }> }>,
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    let id = 1;
    for (const block of blocks) {
      for (const t of block.times) {
        slots.push({ id: id++, day: block.day, startTime: t.start, endTime: t.end });
      }
    }
    return slots;
  }

  function buildFlexibleOffering(opts: {
    id: number;
    courseId: number;
    sks: number;
    room: Room;
  }): CourseOffering {
    return {
      id: opts.id,
      courseId: opts.courseId,
      course: { ...buildCourse(), id: opts.courseId, sks: opts.sks },
      roomId: opts.room.id,
      room: opts.room,
      lecturers: [buildLecturer()],
      effectiveStudentCount: 20,
      isFixed: false,
    };
  }

  it('(a) takes max(perDayLongestRun) — 3-slot run on Mon, 5-slot run on Tue → longestContiguousRun === 5', () => {
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildSlotsFromBlocks([
      {
        day: 'Mon',
        times: [
          { start: '08:00', end: '09:00' },
          { start: '09:00', end: '10:00' },
          { start: '10:00', end: '11:00' },
        ],
      },
      {
        day: 'Tue',
        times: [
          { start: '08:00', end: '09:00' },
          { start: '09:00', end: '10:00' },
          { start: '10:00', end: '11:00' },
          { start: '11:00', end: '12:00' },
          { start: '12:00', end: '13:00' },
        ],
      },
    ]);
    const offering = buildFlexibleOffering({
      id: 1,
      courseId: 401,
      sks: 1,
      room: rooms[0]!,
    });

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    // possibleTimeSlotIds spans both days; the day-grouped reducer must pick
    // the longer of the two per-day runs (5 on Tue) and never cross days.
    expect(candidate.longestContiguousRun).toBe(5);
    // sessionDuration (1) <= longestContiguousRun → no fragmentation flag.
    expect(candidate.fragmentationRequired).toBeUndefined();
  });

  it('(b) only 3-slot runs exist and sessionDuration === 5 → longestContiguousRun === 3, fragmentationRequired === true', () => {
    const rooms = [buildRoom(1, 30)];
    // Mon fragments into two 3-slot blocks separated by an 11:00-12:00 gap;
    // OQ-32 strict equality means the gap terminates the run, so no day
    // ever exceeds 3 contiguous slots.
    const timeSlots = buildSlotsFromBlocks([
      {
        day: 'Mon',
        times: [
          { start: '08:00', end: '09:00' },
          { start: '09:00', end: '10:00' },
          { start: '10:00', end: '11:00' },
          // gap 11:00 — 12:00
          { start: '12:00', end: '13:00' },
          { start: '13:00', end: '14:00' },
          { start: '14:00', end: '15:00' },
        ],
      },
    ]);
    const offering = buildFlexibleOffering({
      id: 2,
      courseId: 402,
      sks: 5, // session needs 5 contiguous slots; no day holds 5 in a row
      room: rooms[0]!,
    });

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.longestContiguousRun).toBe(3);
    expect(candidate.fragmentationRequired).toBe(true);
  });

  it('(c) sessionDuration === 3 fits inside a 5-slot run → no fragmentationRequired flag (sparse, not `false`)', () => {
    const rooms = [buildRoom(1, 30)];
    const timeSlots = buildSlotsFromBlocks([
      {
        day: 'Mon',
        times: [
          { start: '08:00', end: '09:00' },
          { start: '09:00', end: '10:00' },
          { start: '10:00', end: '11:00' },
          { start: '11:00', end: '12:00' },
          { start: '12:00', end: '13:00' },
        ],
      },
    ]);
    const offering = buildFlexibleOffering({
      id: 3,
      courseId: 403,
      sks: 3,
      room: rooms[0]!,
    });

    const { candidates } = runPreGA([offering], timeSlots, rooms);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.longestContiguousRun).toBe(5);
    // Sparse-on-purpose contract from types.ts: the flag is OMITTED when the
    // session fits, never stamped `false`. Consumers `if (c.fragmentationRequired)`.
    expect(candidate.fragmentationRequired).toBeUndefined();
    expect('fragmentationRequired' in candidate).toBe(false);
  });
});
