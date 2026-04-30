-- 20260430120300_competencies_to_array
--
-- Promotes `lecturers.competencies` and `courses.requiredCompetencies` from
-- the `TEXT NOT NULL` shape created by 20260430120000_init to native
-- `TEXT[] NOT NULL DEFAULT '{}'` (Postgres `String[]`), per techspec
-- [ARCH-OBS-05] / [HC-COMPETENCY] §5.5 and api_design §3.5.
--
-- Migration strategy choice
-- -------------------------
-- The previous init migration created these columns as `TEXT NOT NULL`,
-- intended to hold a JSON-encoded array (e.g., `'[]'` or `'["algorithms"]'`).
-- This repository has no production data yet (only seed/test fixtures), so
-- we use a forgiving USING clause that:
--   1. Treats `''` or NULL-equivalent values as the empty array.
--   2. Parses any valid JSON array via `::jsonb` → `text[]` for forward
--      compatibility with previously-seeded JSON values.
--   3. Otherwise falls back to a single-element array containing the raw
--      text — defensive against any non-JSON data that may have been
--      inserted ad-hoc during early development.
--
-- For the SQLite target (OQ-3 fallback), this migration is skipped because
-- the SQLite-portable variant keeps the columns as `TEXT`. The runtime
-- codec at `src/repo/competencyCodec.ts` handles both forms.

ALTER TABLE "lecturers"
    ALTER COLUMN "competencies" DROP DEFAULT,
    ALTER COLUMN "competencies" TYPE TEXT[] USING (
        CASE
            WHEN "competencies" IS NULL OR "competencies" = '' THEN ARRAY[]::TEXT[]
            WHEN "competencies" ~ '^\[' THEN ARRAY(SELECT jsonb_array_elements_text("competencies"::jsonb))
            ELSE ARRAY["competencies"]::TEXT[]
        END
    ),
    ALTER COLUMN "competencies" SET DEFAULT '{}',
    ALTER COLUMN "competencies" SET NOT NULL;

ALTER TABLE "courses"
    ALTER COLUMN "requiredCompetencies" DROP DEFAULT,
    ALTER COLUMN "requiredCompetencies" TYPE TEXT[] USING (
        CASE
            WHEN "requiredCompetencies" IS NULL OR "requiredCompetencies" = '' THEN ARRAY[]::TEXT[]
            WHEN "requiredCompetencies" ~ '^\[' THEN ARRAY(SELECT jsonb_array_elements_text("requiredCompetencies"::jsonb))
            ELSE ARRAY["requiredCompetencies"]::TEXT[]
        END
    ),
    ALTER COLUMN "requiredCompetencies" SET DEFAULT '{}',
    ALTER COLUMN "requiredCompetencies" SET NOT NULL;
