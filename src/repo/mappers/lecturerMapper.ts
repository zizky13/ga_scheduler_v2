/**
 * Lecturer mapper — Prisma `lecturers` row (with `LecturerPreferredSlot[]`
 * join) to `src/types.ts:Lecturer`.
 *
 * Decodes `competencies` via the dual-target codec (Postgres `string[]` /
 * SQLite JSON-encoded `string`) and resolves `preferredTimeSlotIds` from the
 * `LecturerPreferredSlot[]` join.
 */

import type { Lecturer } from '../../types';
import { decodeCompetencies } from '../competencyCodec';

export interface LecturerRowFull {
  id: number;
  name: string;
  isStructural: boolean;
  maxSks: number;
  /** Postgres: `string[]`. SQLite: JSON-encoded `string`. */
  competencies: string | string[] | null | undefined;
  preferredSlots: ReadonlyArray<{ timeSlotId: number }>;
}

export function mapLecturerRow(row: LecturerRowFull): Lecturer {
  return {
    id: row.id,
    name: row.name,
    isStructural: row.isStructural,
    maxSks: row.maxSks,
    preferredTimeSlotIds: row.preferredSlots.map((p) => p.timeSlotId),
    competencies: decodeCompetencies(row.competencies),
  };
}
