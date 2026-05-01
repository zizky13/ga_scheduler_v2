/**
 * Course mapper — Prisma `courses` row (with `CourseRequiredFacility[] →
 * Facility`) to `src/types.ts:Course`.
 *
 * Resolves `requiredFacilities` (Facility.code values) from the join and
 * decodes `requiredCompetencies` via the dual-target codec.
 */

import type { Course } from '../../types';
import { decodeCompetencies } from '../competencyCodec';

export interface CourseRowFull {
  id: number;
  code: string;
  name: string;
  sks: number;
  /** Postgres: `string[]`. SQLite: JSON-encoded `string`. */
  requiredCompetencies: string | string[] | null | undefined;
  requiredFacilities: ReadonlyArray<{
    facility: { code: string };
  }>;
}

export function mapCourseRow(row: CourseRowFull): Course {
  const requiredFacilities = row.requiredFacilities.map((rf, i) => {
    const code = rf.facility?.code;
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error(
        `Course ${row.id}: requiredFacilities[${i}] missing or empty facility.code`,
      );
    }
    return code;
  });

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sks: row.sks,
    requiredFacilities,
    requiredCompetencies: decodeCompetencies(row.requiredCompetencies),
  };
}
