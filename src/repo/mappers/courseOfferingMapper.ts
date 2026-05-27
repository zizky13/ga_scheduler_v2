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
 * entities.
 *
 * note (Phase 14 #6): Defects are a Pre-GA concern, not a mapper concern.
 * The only acceptable mapper throw is the missing-course one below (a
 * totally-missing course makes the offering structurally unrepresentable
 * because `CourseOffering.course: Course` is non-optional). Missing
 * lecturer / room references are recorded into `mappingDefects` on the
 * returned offering and surface as `CROSS_SEMESTER_DEFECT` at
 * `checkIntegrity` time — turning what used to be a worker-killing throw
 * into a single-offering `preGASummary.infeasible[]` entry per
 * api_design §5.2.
 */
export function mapCourseOfferingRow(
  row: CourseOfferingRowFull,
  lecturerById: ReadonlyMap<number, Lecturer>,
  roomById: ReadonlyMap<number, Room>,
  courseById: ReadonlyMap<number, Course>,
): CourseOffering {
  const course = courseById.get(row.courseId);
  if (course === undefined) {
    // Phase 14 #6 contract exception: the course relation is non-optional
    // on `CourseOffering`. A missing course is structurally unrepresentable,
    // so the mapper still throws here. The `mappingDefects.missingCourseId`
    // type slot exists for forward compatibility only — see src/types.ts.
    throw new Error(
      `Course ${row.courseId} referenced by offering ${row.id} not found in courseById map`,
    );
  }

  // Phase 14 #6: previously threw on a non-null roomId that wasn't in the
  // map. Now records the orphan id in `mappingDefects.missingRoomId` and
  // sets `room: null`. We preserve `row.roomId` on the returned offering so
  // Pre-GA can name the orphan in its rejection message — only the
  // `room` relation is forced to null. Phase 7 (null roomId at data-entry)
  // still flows through with `room: null` and no defect recorded.
  let room: Room | null = null;
  let missingRoomId: number | null = null;
  if (row.roomId !== null) {
    const found = roomById.get(row.roomId);
    if (found === undefined) {
      missingRoomId = row.roomId;
    } else {
      room = found;
    }
  }

  // Phase 14 #6: drop missing-lecturer references rather than throwing.
  // The orphan ids are collected into `mappingDefects.missingLecturerIds`
  // so `checkIntegrity` can emit `CROSS_SEMESTER_DEFECT` for them.
  const lecturers: Lecturer[] = [];
  const missingLecturerIds: number[] = [];
  for (const l of row.lecturers) {
    const lec = lecturerById.get(l.lecturerId);
    if (lec === undefined) {
      missingLecturerIds.push(l.lecturerId);
    } else {
      lecturers.push(lec);
    }
  }

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

  // Phase 14 #6: attach defects only when present. Clean offerings get no
  // `mappingDefects` key at all (matches the optional-property semantics
  // of `CourseOffering` in src/types.ts).
  if (missingLecturerIds.length > 0 || missingRoomId !== null) {
    const defects: NonNullable<CourseOffering['mappingDefects']> = {};
    if (missingLecturerIds.length > 0) {
      defects.missingLecturerIds = missingLecturerIds;
    }
    if (missingRoomId !== null) {
      defects.missingRoomId = missingRoomId;
    }
    base.mappingDefects = defects;
  }

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
