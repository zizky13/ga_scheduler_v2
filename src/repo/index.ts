/**
 * Public surface of the repository layer.
 *
 * Phase 1 task 7 lands the full row→domain mapping for `Room`, `TimeSlot`,
 * `Lecturer`, `Course`, `CourseOffering`, and `LockedRoom`, plus the
 * `loadScheduleInputs` facade the worker will call before invoking the GA
 * pipeline. The pure mappers under `./mappers/` are Prisma-import-free; only
 * `./scheduleRepo.ts` touches the runtime Prisma client (api_design §3.5).
 *
 * Note: this module intentionally does NOT re-export `PrismaClient`. Callers
 * that need it should import from `@prisma/client` directly so the dependency
 * stays explicit at the boundary.
 */

export {
  encodeCompetencies,
  decodeCompetencies,
  getCompetencyTarget,
  type CompetencyTarget,
} from './competencyCodec';

// Legacy adapters retained for backward compatibility (Phase 1 task 5).
export { toLecturer, type LecturerRowExtras } from './lecturerRepo';
export { toCourse, type CourseRowExtras } from './courseRepo';

export type { LecturerRow, CourseRow } from './types';

// Phase 1 task 7 — pure row→domain mappers.
export { mapRoomRow, type RoomRow } from './mappers/roomMapper';
export {
  mapTimeSlotRow,
  weekdayToString,
  type TimeSlotRow,
} from './mappers/timeSlotMapper';
export {
  mapLecturerRow,
  type LecturerRowFull,
} from './mappers/lecturerMapper';
export { mapCourseRow, type CourseRowFull } from './mappers/courseMapper';
export {
  mapCourseOfferingRow,
  type CourseOfferingRowFull,
} from './mappers/courseOfferingMapper';
export {
  mapLockedRoomRow,
  type LockedRoomRow,
} from './mappers/lockedRoomMapper';

// Phase 1 task 7 — Prisma-aware facade (worker entry point).
export {
  loadScheduleInputs,
  getActiveSemesterId,
  type ScheduleRepoInputs,
} from './scheduleRepo';

// Phase 2 task 5 — CRUD repos for /users /semesters /rooms /timeslots
// /facilities /locked-rooms.
export {
  createUserRepository,
  type UserRepository,
  type UserRecord,
  type CreateUserInput,
  type UpdateUserInput,
  type ListUsersOptions,
} from './userRepo';
export {
  createSemesterRepository,
  type SemesterRepository,
  type SemesterRecord,
  type CreateSemesterInput,
  type UpdateSemesterInput,
} from './semesterRepo';
export {
  createRoomRepository,
  UnknownFacilityCodeError,
  type RoomRepository,
  type RoomRecord,
  type CreateRoomInput,
  type UpdateRoomInput,
} from './roomRepo';
export {
  createTimeSlotRepository,
  type TimeSlotRepository,
  type TimeSlotRecord,
  type CreateTimeSlotInput,
  type UpdateTimeSlotInput,
} from './timeslotRepo';
export {
  createFacilityRepository,
  type FacilityRepository,
  type FacilityRecord,
  type CreateFacilityInput,
  type UpdateFacilityInput,
} from './facilityRepo';
export {
  createLockedRoomRepository,
  type LockedRoomRepository,
  type LockedRoomRecord,
  type CreateLockedRoomInput,
  type UpdateLockedRoomInput,
} from './lockedRoomRepo';

// Phase 2 task 6 — CRUD repos for /lecturers /courses /course-offerings.
export {
  createLecturerRepository,
  type LecturerRepository,
  type LecturerRecord,
  type CreateLecturerInput,
  type UpdateLecturerInput,
  type ListLecturersOptions,
} from './lecturerCrudRepo';
export {
  createCourseRepository,
  type CourseRepository,
  type CourseRecord,
  type CreateCourseInput,
  type UpdateCourseInput,
  type ListCoursesOptions,
} from './courseCrudRepo';
export {
  createCourseOfferingRepository,
  type CourseOfferingRepository,
  type CourseOfferingRecord,
  type CreateCourseOfferingInput,
  type UpdateCourseOfferingInput,
  type ListCourseOfferingsOptions,
} from './courseOfferingRepo';
