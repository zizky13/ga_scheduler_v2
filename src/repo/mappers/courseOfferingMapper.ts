/**
 * CourseOffering mapper — Prisma `course_offerings` row (with `lecturers`,
 * `fixedSlots` joins) to `src/types.ts:CourseOffering`.
 *
 * Populates nested `course`, `room`, and `lecturers[]` references via the
 * caller-supplied by-id maps so a full schedule load can avoid N+1 queries.
 * Resolves `fixedTimeSlotIds` from the `CourseOfferingFixedSlot[]` join only
 * when `isFixed` is true; otherwise the property is omitted entirely (matches
 * the optional-property semantics of `CourseOffering` in `src/types.ts`).
 */

import type { Course, CourseOffering, Lecturer, Room } from '../../types';

export interface CourseOfferingRowFull {
  id: number;
  courseId: number;
  roomId: number | null;
  effectiveStudentCount: number;
  isFixed: boolean;
  parentOfferingId: number | null;
  lecturers: ReadonlyArray<{ lecturerId: number }>;
  fixedSlots: ReadonlyArray<{ timeSlotId: number }>;
}

/**
 * Pure mapping. Returns a new object without mutating any input — the
 * caller's by-id maps are read-only views into already-mapped domain
 * entities. Throws a clear error when any referenced id is missing from its
 * map (defensive boundary check).
 */
export function mapCourseOfferingRow(
  row: CourseOfferingRowFull,
  lecturerById: ReadonlyMap<number, Lecturer>,
  roomById: ReadonlyMap<number, Room>,
  courseById: ReadonlyMap<number, Course>,
): CourseOffering {
  const course = courseById.get(row.courseId);
  if (course === undefined) {
    throw new Error(
      `Course ${row.courseId} referenced by offering ${row.id} not found in courseById map`,
    );
  }

  // Phase 7: roomId is optional. A null roomId means the offering was created
  // without a room assignment — pre-GA flags it as MISSING_ROOM rather than
  // crashing the loader here. Only throw when a non-null roomId references a
  // room that's missing from the map (data corruption).
  let room: Room | null = null;
  if (row.roomId !== null) {
    const found = roomById.get(row.roomId);
    if (found === undefined) {
      throw new Error(
        `Room ${row.roomId} referenced by offering ${row.id} not found in roomById map`,
      );
    }
    room = found;
  }

  const lecturers: Lecturer[] = row.lecturers.map((l) => {
    const lec = lecturerById.get(l.lecturerId);
    if (lec === undefined) {
      throw new Error(
        `Lecturer ${l.lecturerId} referenced by offering ${row.id} not found in lecturerById map`,
      );
    }
    return lec;
  });

  const base: CourseOffering = {
    id: row.id,
    courseId: row.courseId,
    course,
    roomId: row.roomId,
    room,
    lecturers,
    effectiveStudentCount: row.effectiveStudentCount,
    isFixed: row.isFixed,
  };

  if (row.isFixed) {
    base.fixedTimeSlotIds = row.fixedSlots.map((f) => f.timeSlotId);
  }
  // When isFixed === false, fixedTimeSlotIds is intentionally absent (omitted
  // rather than set to []) to match the optional-property semantics of
  // src/types.ts:CourseOffering.

  if (row.parentOfferingId !== null && row.parentOfferingId !== undefined) {
    base.parentOfferingId = row.parentOfferingId;
  }

  return base;
}
