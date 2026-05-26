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
