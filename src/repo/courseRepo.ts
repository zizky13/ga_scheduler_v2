/**
 * Course repository adapter — minimal slice for Phase 1 task 5.
 *
 * Today this module only demonstrates the codec boundary: it decodes the
 * `requiredCompetencies` column into the `string[]` shape required by
 * `src/types.ts:Course.requiredCompetencies`. The full row→domain mapping
 * (including `requiredFacilities` and audit columns) lands in Phase 1
 * task 7 per `backlog.md`.
 *
 * Prisma-import-free by design — see `lecturerRepo.ts` for the rationale.
 */

import type { Course } from '../types';
import { decodeCompetencies } from './competencyCodec';
import type { CourseRow } from './types';

/**
 * Extras the caller is expected to resolve from related tables. Phase 1
 * task 7 will absorb this work into the repository.
 */
export type CourseRowExtras = {
  requiredFacilities: string[];
};

/**
 * Adapts a Prisma `courses` row (plus its extras) to the in-memory `Course`
 * domain type used by the GA core. Decodes `requiredCompetencies` via the
 * dual-target codec.
 *
 * @see Phase 1 task 7 in `backlog.md` for the full row-fetch implementation.
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
