/**
 * Lecturer repository adapter.
 *
 * Phase 1 task 7: full row→domain mapping now lives in
 * `./mappers/lecturerMapper.ts`. This file keeps the original
 * `toLecturer(row, extras)` shape exported for backward compatibility with
 * existing callers / tests but delegates the heavy lifting to the canonical
 * mapper.
 *
 * Prisma-import-free at runtime; operates on plain row shapes only.
 */

import type { Lecturer } from '../types';
import { decodeCompetencies } from './competencyCodec';
import type { LecturerRow } from './types';
import { mapLecturerRow } from './mappers/lecturerMapper';

/**
 * Extras the caller is expected to resolve from related tables before
 * calling the legacy `toLecturer` adapter. Phase 1 task 7's `mapLecturerRow`
 * absorbs this resolution into the mapper signature.
 *
 * @deprecated Prefer `mapLecturerRow` from `./mappers/lecturerMapper.ts`,
 * which accepts the included Prisma row directly.
 */
export type LecturerRowExtras = {
  preferredTimeSlotIds: number[];
};

/**
 * Adapts a minimal Prisma `lecturers` row (plus its extras) to the in-memory
 * `Lecturer` domain type used by the GA core. Decodes `competencies` via the
 * dual-target codec.
 *
 * @deprecated Prefer `mapLecturerRow` from `./mappers/lecturerMapper.ts`,
 * which works directly off the included row shape returned by Prisma.
 */
export function toLecturer(
  row: LecturerRow,
  extras: LecturerRowExtras,
): Lecturer {
  return {
    id: row.id,
    name: row.name,
    isStructural: row.isStructural,
    maxSks: row.maxSks,
    preferredTimeSlotIds: extras.preferredTimeSlotIds,
    competencies: decodeCompetencies(row.competencies),
  };
}

export { mapLecturerRow };
