/**
 * Repository row-shape types.
 *
 * Minimal Prisma-row slices used by the competency codec adapters in
 * `lecturerRepo.ts` and `courseRepo.ts`. The shapes intentionally only
 * capture the columns the codec must touch today; the full row→domain
 * mapping (including `preferredTimeSlotIds`, `requiredFacilities`, etc.) is
 * Phase 1 task 7's job per `backlog.md`.
 *
 * The `competencies` / `requiredCompetencies` fields are typed as
 * `string | string[]` so this module compiles cleanly against either Prisma
 * provider variant — see `competencyCodec.ts` for the full rationale.
 */

/** Shape of a Prisma `lecturers` row prior to decoding. */
export type LecturerRow = {
  id: number;
  name: string;
  isStructural: boolean;
  /** Postgres: `string[]`. SQLite: JSON-encoded `string`. */
  competencies: string | string[];
  // Other Prisma scalars (semesterId, createdAt, etc.) and relation joins
  // (preferredSlots) are intentionally omitted here; Phase 1 task 7 will
  // expand this row type when the full repository layer lands.
};

/** Shape of a Prisma `courses` row prior to decoding. */
export type CourseRow = {
  id: number;
  code: string;
  name: string;
  sks: number;
  /** Postgres: `string[]`. SQLite: JSON-encoded `string`. */
  requiredCompetencies: string | string[];
  // Other Prisma scalars and relations (requiredFacilities) deferred to
  // Phase 1 task 7.
};
