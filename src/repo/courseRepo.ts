/**
 * Course repository adapter.
 *
 * Phase 1 task 7: full row→domain mapping now lives in
 * `./mappers/courseMapper.ts`. This file keeps the original
 * `toCourse(row, extras)` shape exported for backward compatibility but
 * delegates the canonical work to `mapCourseRow`.
 *
 * Prisma-import-free at runtime — see `./mappers/courseMapper.ts`.
 */

import type { Course } from '../types';
import { decodeCompetencies } from './competencyCodec';
import type { CourseRow } from './types';
import { mapCourseRow } from './mappers/courseMapper';

/**
 * Extras the caller is expected to resolve from related tables before
 * calling the legacy `toCourse` adapter.
 *
 * @deprecated Prefer `mapCourseRow` from `./mappers/courseMapper.ts`.
 */
export type CourseRowExtras = {
  requiredFacilities: string[];
};

/**
 * Adapts a minimal Prisma `courses` row (plus its extras) to the in-memory
 * `Course` domain type used by the GA core.
 *
 * @deprecated Prefer `mapCourseRow` from `./mappers/courseMapper.ts`.
 */
export function toCourse(row: CourseRow, extras: CourseRowExtras): Course {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sks: row.sks,
    requiredFacilities: extras.requiredFacilities,
    requiredCompetencies: decodeCompetencies(row.requiredCompetencies),
  };
}

export { mapCourseRow };
