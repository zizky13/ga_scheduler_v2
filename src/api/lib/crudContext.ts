/**
 * Lightweight DI seam for the Phase 2 Task 5 CRUD entities (`users`,
 * `semesters`, `rooms`, `timeslots`, `facilities`, `locked-rooms`).
 *
 * Mirrors `./authContext.ts`:
 *   - Production: lazy `getPrisma()` builds a singleton client and the real
 *     repositories wrap it.
 *   - Tests: `setCrudRepositoriesForTests({ ... })` replaces all repos with
 *     in-memory fakes so route handlers are exercised without Prisma.
 *
 * Keep this file boring: no business logic, just wiring.
 */

import type { UserRepository } from '../../repo/userRepo';
import type { SemesterRepository } from '../../repo/semesterRepo';
import type { RoomRepository } from '../../repo/roomRepo';
import type { TimeSlotRepository } from '../../repo/timeslotRepo';
import type { FacilityRepository } from '../../repo/facilityRepo';
import type { LockedRoomRepository } from '../../repo/lockedRoomRepo';
import type { LecturerRepository } from '../../repo/lecturerCrudRepo';
import type { CourseRepository } from '../../repo/courseCrudRepo';
import type { CourseOfferingRepository } from '../../repo/courseOfferingRepo';
import type { AuditLogRepository } from '../../repo/auditLogRepo';
import type { ScheduleRunRepository } from '../../repo/scheduleRunRepo';

import { createUserRepository } from '../../repo/userRepo';
import { createSemesterRepository } from '../../repo/semesterRepo';
import { createRoomRepository } from '../../repo/roomRepo';
import { createTimeSlotRepository } from '../../repo/timeslotRepo';
import { createFacilityRepository } from '../../repo/facilityRepo';
import { createLockedRoomRepository } from '../../repo/lockedRoomRepo';
import { createLecturerRepository } from '../../repo/lecturerCrudRepo';
import { createCourseRepository } from '../../repo/courseCrudRepo';
import { createCourseOfferingRepository } from '../../repo/courseOfferingRepo';
import { createAuditLogRepository } from '../../repo/auditLogRepo';
import { createScheduleRunRepository } from '../../repo/scheduleRunRepo';
import { getPrisma } from '../../repo/prisma';

export interface CrudRepositories {
  users: UserRepository;
  semesters: SemesterRepository;
  rooms: RoomRepository;
  timeSlots: TimeSlotRepository;
  facilities: FacilityRepository;
  lockedRooms: LockedRoomRepository;
  lecturers: LecturerRepository;
  courses: CourseRepository;
  courseOfferings: CourseOfferingRepository;
  auditLogs: AuditLogRepository;
  scheduleRuns: ScheduleRunRepository;
}

let cached: CrudRepositories | undefined;
let override: CrudRepositories | undefined;

export function getCrudRepositories(): CrudRepositories {
  if (override) return override;
  if (!cached) {
    const prisma = getPrisma();
    cached = {
      users: createUserRepository(prisma),
      semesters: createSemesterRepository(prisma),
      rooms: createRoomRepository(prisma),
      timeSlots: createTimeSlotRepository(prisma),
      facilities: createFacilityRepository(prisma),
      lockedRooms: createLockedRoomRepository(prisma),
      lecturers: createLecturerRepository(prisma),
      courses: createCourseRepository(prisma),
      courseOfferings: createCourseOfferingRepository(prisma),
      auditLogs: createAuditLogRepository(prisma),
      scheduleRuns: createScheduleRunRepository(prisma),
    };
  }
  return cached;
}

/**
 * Test-only: install in-memory or sandboxed repositories. Pass `undefined`
 * to fall back to the cached production wiring.
 */
export function setCrudRepositoriesForTests(repos: CrudRepositories | undefined): void {
  override = repos;
}
