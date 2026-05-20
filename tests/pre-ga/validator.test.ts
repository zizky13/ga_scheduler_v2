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
