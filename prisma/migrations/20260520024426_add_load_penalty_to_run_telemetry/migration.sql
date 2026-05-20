-- AlterTable
ALTER TABLE "fitness_history" ADD COLUMN     "loadPenalty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "schedule_runs" ADD COLUMN     "loadPenalty" INTEGER NOT NULL DEFAULT 0;
