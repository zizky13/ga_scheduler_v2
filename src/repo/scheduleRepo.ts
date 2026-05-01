/**
 * Schedule repository facade.
 *
 * This file is the ONLY place in `src/repo/` that touches the Prisma runtime
 * client directly. All other modules (`./mappers/*.ts`, `./competencyCodec.ts`)
 * are pure functions over plain row shapes so the GA core in `src/ga/`,
 * `src/pre-ga/`, and `src/ssa/` stays Prisma-unaware (techspec §5.2,
 * api_design §3.5).
 *
 * Worker integration: `loadScheduleInputs(prisma, semesterId)` is the
 * entry point Phase 3's worker (`src/worker/index.ts`) will call before
 * handing plain TS types to `runPipeline()` in `src/orchestrator.ts`.
 *
 * Test gap: there is intentionally NO unit test for `loadScheduleInputs`
 * itself — that requires a live Prisma connection and belongs in the
 * integration-test phase tracked under Phase 5 backlog item 1.
 */

import type { PrismaClient } from '@prisma/client';

import type {
  Course,
  CourseOffering,
  Lecturer,
  LockedRoom,
  Room,
  TimeSlot,
} from '../types';

import { mapRoomRow } from './mappers/roomMapper';
import { mapTimeSlotRow } from './mappers/timeSlotMapper';
import { mapLecturerRow } from './mappers/lecturerMapper';
import { mapCourseRow } from './mappers/courseMapper';
import { mapCourseOfferingRow } from './mappers/courseOfferingMapper';
import { mapLockedRoomRow } from './mappers/lockedRoomMapper';

export interface ScheduleRepoInputs {
  rooms: Room[];
  timeSlots: TimeSlot[];
  lecturers: Lecturer[];
  courses: Course[];
  offerings: CourseOffering[];
  lockedRooms: LockedRoom[];
  /**
   * offeringId → resolved roomId, suitable for `entityTagger`'s
   * `lockedRoomMap` parameter (techspec §5.4 / FR-01,
   * `src/pre-ga/entityTagger.ts`).
   */
  lockedRoomMap: Map<number, number>;
}

/**
 * Loads every entity the GA pipeline needs for a single run, scoped to
 * `semesterId`. Top-level Prisma fetches run in parallel via `Promise.all`;
 * each query `include`s only the relations its mapper needs.
 *
 * The function intentionally builds by-id maps in memory rather than
 * issuing per-offering joins so the cost stays O(N) regardless of the
 * number of offerings.
 */
export async function loadScheduleInputs(
  prisma: PrismaClient,
  semesterId: number,
): Promise<ScheduleRepoInputs> {
  const [
    roomRows,
    timeSlotRows,
    lecturerRows,
    courseRows,
    offeringRows,
    lockedRoomRows,
  ] = await Promise.all([
    prisma.room.findMany({
      where: { semesterId },
      include: {
        facilities: { include: { facility: { select: { code: true } } } },
      },
    }),
    prisma.timeSlot.findMany({
      where: { semesterId },
    }),
    prisma.lecturer.findMany({
      where: { semesterId },
      include: {
        preferredSlots: { select: { timeSlotId: true } },
      },
    }),
    prisma.course.findMany({
      where: { semesterId },
      include: {
        requiredFacilities: {
          include: { facility: { select: { code: true } } },
        },
      },
    }),
    prisma.courseOffering.findMany({
      where: { semesterId },
      include: {
        lecturers: { select: { lecturerId: true } },
        fixedSlots: { select: { timeSlotId: true } },
      },
    }),
    prisma.lockedRoom.findMany({
      where: { semesterId },
    }),
  ]);

  const rooms = roomRows.map(mapRoomRow);
  const timeSlots = timeSlotRows.map(mapTimeSlotRow);
  const lecturers = lecturerRows.map(mapLecturerRow);
  const courses = courseRows.map(mapCourseRow);

  const roomById = new Map<number, Room>(rooms.map((r) => [r.id, r]));
  const lecturerById = new Map<number, Lecturer>(
    lecturers.map((l) => [l.id, l]),
  );
  const courseById = new Map<number, Course>(courses.map((c) => [c.id, c]));

  const offerings = offeringRows.map((row) =>
    mapCourseOfferingRow(row, lecturerById, roomById, courseById),
  );

  const lockedRooms = lockedRoomRows.map(mapLockedRoomRow);

  // Defensive validation: the schema's @unique on offeringId should prevent
  // duplicates, but the boundary checks anyway — a duplicate would silently
  // overwrite the entityTagger's per-offering room id.
  const lockedRoomMap = new Map<number, number>();
  for (const lr of lockedRooms) {
    if (lockedRoomMap.has(lr.offeringId)) {
      throw new Error(
        `Duplicate LockedRoom for offeringId ${lr.offeringId} — ` +
          `LockedRoom.offeringId must be unique per schema.`,
      );
    }
    lockedRoomMap.set(lr.offeringId, lr.roomId);
  }

  return {
    rooms,
    timeSlots,
    lecturers,
    courses,
    offerings,
    lockedRooms,
    lockedRoomMap,
  };
}

/**
 * Returns the id of the active semester. Mirrors the `NO_ACTIVE_SEMESTER`
 * 422 error code from api_design §5.3.8 — exactly one `Semester` row should
 * have `isActive = true`.
 */
export async function getActiveSemesterId(
  prisma: PrismaClient,
): Promise<number> {
  const rows = await prisma.semester.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  if (rows.length === 0) {
    throw new Error('NO_ACTIVE_SEMESTER');
  }
  if (rows.length > 1) {
    throw new Error(
      'Multiple active semesters — exactly one Semester.isActive must be true',
    );
  }
  return rows[0]!.id;
}
