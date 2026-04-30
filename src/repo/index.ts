/**
 * Public surface of the repository layer.
 *
 * Phase 1 task 5 only ships the competency codec primitive plus minimal
 * lecturer/course adapters that demonstrate the dual-target boundary. The
 * full repository (Room, CourseOffering, LockedRoom, etc.) lands in Phase 1
 * task 7 per `backlog.md`.
 */

export {
  encodeCompetencies,
  decodeCompetencies,
  getCompetencyTarget,
  type CompetencyTarget,
} from './competencyCodec';

export { toLecturer, type LecturerRowExtras } from './lecturerRepo';
export { toCourse, type CourseRowExtras } from './courseRepo';

export type { LecturerRow, CourseRow } from './types';
