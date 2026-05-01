/**
 * Competency codec — dual-target encoding for `Lecturer.competencies` and
 * `Course.requiredCompetencies`.
 *
 * Spec sources:
 *   - techspec_upj_scheduler_v2.md §5.5 [HC-COMPETENCY] and `[ARCH-OBS-05]`
 *     (around line 514).
 *   - docs/api_and_database_design.md §3.5 migration notes row `[ARCH-OBS-05]`
 *     (around line 640).
 *
 * Why this module exists
 * ----------------------
 * The competency arrays must be persisted differently per database target:
 *   - Postgres: native `String[]` column (`text[]`).
 *   - SQLite/libSQL: a single `String` column holding a JSON-encoded array
 *     (e.g., `'["algorithms","ai-ml"]'`), because SQLite has no native array
 *     type.
 *
 * Prisma cannot type a column conditionally per provider, so the schema must
 * pick one column shape at build time and the runtime codec must know which
 * target was chosen so it can encode/decode accordingly. The
 * `getCompetencyTarget()` helper reads the `DATABASE_PROVIDER` env var (with
 * a default that matches the current `prisma/schema.prisma` `datasource`
 * provider) to provide that signal without forcing Prisma to be the source
 * of truth at runtime.
 *
 * The `decodeCompetencies` function intentionally accepts BOTH shapes so the
 * repository layer can transparently handle either provider — the in-memory
 * shape always matches `src/types.ts:Lecturer.competencies` (`string[]`) and
 * `src/types.ts:Course.requiredCompetencies` (`string[]`).
 */

export type CompetencyTarget = 'postgres' | 'sqlite';

/**
 * Reads the runtime competency target. Defaults to `'postgres'` to match the
 * current `prisma/schema.prisma` `datasource.provider = "postgresql"`.
 *
 * Override via `DATABASE_PROVIDER=sqlite` (or `postgres`) when the
 * SQLite-portable schema variant is in use. OQ-3 is resolved (Postgres
 * pinned). This helper still exists so the codec can support the SQLite
 * thesis-defense fallback via `DATABASE_PROVIDER=sqlite` without rebuilding.
 */
export function getCompetencyTarget(): CompetencyTarget {
  const raw = (process.env.DATABASE_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'sqlite') return 'sqlite';
  if (raw === 'postgres' || raw === 'postgresql' || raw === '') return 'postgres';
  throw new Error(
    `Invalid DATABASE_PROVIDER='${process.env.DATABASE_PROVIDER}'. Expected 'postgres' or 'sqlite'.`,
  );
}

/**
 * Validates a single competency tag: must be a string, must be non-empty
 * after trimming. Returns the trimmed value.
 */
function validateTag(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid competency entry in ${context}: expected string, got ${typeof value}.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Empty competency tag');
  }
  return trimmed;
}

/**
 * Encodes an in-memory `string[]` for persistence in the chosen target.
 *
 * - Postgres: returns a validated `string[]` (passed through to Prisma's
 *   native `String[]` column).
 * - SQLite: returns `JSON.stringify(values)`. An empty array becomes `"[]"`.
 *
 * Validation: each entry is trimmed and must be non-empty; non-string
 * entries throw.
 */
export function encodeCompetencies(
  values: string[],
  target: CompetencyTarget,
): string[] | string {
  if (!Array.isArray(values)) {
    throw new Error(
      `encodeCompetencies expected an array, got ${typeof values}.`,
    );
  }

  const cleaned = values.map((v, i) => validateTag(v, `index ${i}`));

  if (target === 'postgres') {
    return cleaned;
  }
  // sqlite: JSON-encoded string
  return JSON.stringify(cleaned);
}

/**
 * Decodes a persisted competency value back to the in-memory `string[]`
 * shape used throughout `src/types.ts`.
 *
 * Accepts either the Postgres native form (already a `string[]`) or the
 * SQLite JSON-encoded form (a `string` like `'["a","b"]'`). `null`,
 * `undefined`, and `''` all yield `[]` so callers don't have to special-case
 * empty rows.
 *
 * Throws on:
 *   - malformed JSON (e.g., `'not-json'`),
 *   - JSON that doesn't decode to an array,
 *   - any element that isn't a non-empty string after trim.
 *
 * Loud failure is intentional: corrupt rows must surface immediately rather
 * than silently degrade to an empty competency set, which would make
 * `[HC-COMPETENCY]` (techspec §5.5) silently pass for ineligible lecturers.
 */
export function decodeCompetencies(
  raw: string[] | string | null | undefined,
): string[] {
  if (raw === null || raw === undefined) return [];

  // Postgres native form — already an array.
  if (Array.isArray(raw)) {
    return raw.map((v, i) => validateTag(v, `array index ${i}`));
  }

  // SQLite form — JSON-encoded string.
  if (typeof raw === 'string') {
    if (raw === '') return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid competency JSON for value: ${JSON.stringify(raw)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Invalid competency JSON for value: ${JSON.stringify(raw)} (expected array, got ${typeof parsed}).`,
      );
    }

    return parsed.map((v, i) => validateTag(v, `JSON index ${i}`));
  }

  throw new Error(
    `decodeCompetencies received unsupported input type: ${typeof raw}.`,
  );
}
