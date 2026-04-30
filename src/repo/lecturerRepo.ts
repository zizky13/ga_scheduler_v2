/**
 * Lecturer repository adapter — minimal slice for Phase 1 task 5.
 *
 * Today this module only demonstrates the codec boundary: it decodes the
 * `competencies` column into the `string[]` shape required by
 * `src/types.ts:Lecturer.competencies`. The full row→domain mapping
 * (including the `preferredTimeSlotIds` join, `semesterId`, audit columns,
 * etc.) lands in Phase 1 task 7 per `backlog.md`.
 *
 * This file is intentionally Prisma-import-free — it operates on plain row
 * shapes (see `./types.ts`) so the GA core in `src/ga/`, `src/pre-ga/`, and
 * `src/ssa/` stays Prisma-unaware (techspec §5.2 / api_design §3.5).
 */

import type { Lecturer } from '../types';
import { decodeCompetencies } from './competencyCodec';
import type { LecturerRow } from './types';

/**
 * Extra fields the caller is expected to resolve from related tables and
 * pass in alongside the raw `LecturerRow`. Phase 1 task 7 will move this
 * resolution inside the repository layer; for now the adapter just accepts
 * pre-computed values so callers can wire it up incrementally.
 */
export type LecturerRowExtras = {
  preferredTimeSlotIds: number[];
};

/**
 * Adapts a Prisma `lecturers` row (plus its extras) to the in-memory
 * `Lecturer` domain type used by the GA core. The only non-trivial work is
 * decoding `competencies` via the dual-target codec.
 *
 * @see Phase 1 task 7 in `backlog.md` for the full row-fetch implementation.
 */
export function toLecturer(
  row: LecturerRow,
  extras: LecturerRowExtras,
): Lecturer {
  return {
    id: row.id,
    name: row.name,
    isStructural: row.isStructural,
    preferredTimeSlotIds: extras.preferredTimeSlotIds,
    competencies: decodeCompetencies(row.competencies),
  };
}
