-- 20260507000000_add_session_index_to_schedule_assignments
--
-- SKS Blocks (Persistence) — Phase 1 backlog items 9 & 10.
--
-- Adds `sessionIndex` to `schedule_assignments` so each parallel session of
-- a CourseOffering (Session A, Session B, …) is persisted as its own row
-- rather than being collapsed into a single offering row. Widens the
-- per-run uniqueness constraint accordingly.
--
-- Migration strategy choice
-- -------------------------
-- The repository has no production data for `schedule_assignments` yet
-- (Phase 2 API + Phase 3 worker queue have not shipped, so no real run has
-- written rows). Any pre-existing rows from local development represent a
-- single-session assignment, which maps cleanly onto `sessionIndex = 0`.
-- The column is therefore introduced as `NOT NULL DEFAULT 0`, which:
--   1. Backfills every existing row to ordinal 0 (Session A) deterministically.
--   2. Keeps the legacy uniqueness invariant intact during the swap (only one
--      row per (runId, offeringId) historically → still uniquely identified
--      by (runId, offeringId, 0) under the new key).
--   3. Allows new writes from the Task 11 repository mapper to populate the
--      ordinal explicitly.
--
-- The unique constraint switch is done in two atomic steps: drop the old
-- (runId, offeringId) index, then create the new (runId, offeringId,
-- sessionIndex) index. A single ALTER cannot rename + extend the column
-- list, and reusing the old index name on a wider column set would mask
-- the schema change in the migration history.

-- 1. Add the new ordinal column with a backfill default.
ALTER TABLE "schedule_assignments"
    ADD COLUMN "sessionIndex" INTEGER NOT NULL DEFAULT 0;

-- 2. Drop the legacy per-offering uniqueness — incompatible with multiple
--    parallel sessions writing rows for the same (runId, offeringId).
DROP INDEX "schedule_assignments_runId_offeringId_key";

-- 3. Re-establish per-session uniqueness on the widened key.
CREATE UNIQUE INDEX "schedule_assignments_runId_offeringId_sessionIndex_key"
    ON "schedule_assignments"("runId", "offeringId", "sessionIndex");
