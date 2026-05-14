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
--   2. Parses any valid JSON array via `::jsonb` → `jsonb_to_text_array()`
--      for forward compatibility with previously-seeded JSON values.
--   3. Otherwise falls back to a single-element array containing the raw
--      text — defensive against any non-JSON data that may have been
--      inserted ad-hoc during early development.
--
-- PG 16+ disallows subqueries inside ALTER COLUMN ... TYPE ... USING, so
-- we use a two-step approach: first convert to jsonb, then cast to text[].

-- Step 1: Add temporary jsonb columns and populate them
ALTER TABLE "lecturers" ADD COLUMN "competencies_new" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "lecturers" SET "competencies_new" = (
    CASE
        WHEN "competencies" IS NULL OR "competencies" = '' THEN ARRAY[]::TEXT[]
        WHEN "competencies" ~ '^\[' THEN (
            SELECT array_agg(elem)
            FROM jsonb_array_elements_text("competencies"::jsonb) AS elem
        )
        ELSE ARRAY["competencies"]::TEXT[]
    END
);
ALTER TABLE "lecturers" DROP COLUMN "competencies";
ALTER TABLE "lecturers" RENAME COLUMN "competencies_new" TO "competencies";

ALTER TABLE "courses" ADD COLUMN "requiredCompetencies_new" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "courses" SET "requiredCompetencies_new" = (
    CASE
        WHEN "requiredCompetencies" IS NULL OR "requiredCompetencies" = '' THEN ARRAY[]::TEXT[]
        WHEN "requiredCompetencies" ~ '^\[' THEN (
            SELECT array_agg(elem)
            FROM jsonb_array_elements_text("requiredCompetencies"::jsonb) AS elem
        )
        ELSE ARRAY["requiredCompetencies"]::TEXT[]
    END
);
ALTER TABLE "courses" DROP COLUMN "requiredCompetencies";
ALTER TABLE "courses" RENAME COLUMN "requiredCompetencies_new" TO "requiredCompetencies";
