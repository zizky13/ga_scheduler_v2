-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'STAGNATED', 'SSA_INFEASIBLE', 'PRE_GA_EMPTY', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "schedule_runs" (
    "id" TEXT NOT NULL,
    "semesterId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "configJson" TEXT NOT NULL,
    "ssaResultJson" TEXT,
    "preGASummaryJson" TEXT,
    "currentGeneration" INTEGER NOT NULL DEFAULT 0,
    "generationsRun" INTEGER NOT NULL DEFAULT 0,
    "bestFitness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hardViolations" INTEGER NOT NULL DEFAULT 0,
    "softPenalty" INTEGER NOT NULL DEFAULT 0,
    "competencyMismatch" INTEGER NOT NULL DEFAULT 0,
    "stagnatedEarly" BOOLEAN NOT NULL DEFAULT false,
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "avgHistoryJson" TEXT NOT NULL DEFAULT '[]',
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,

    CONSTRAINT "schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_assignments" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "offeringId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "isFixedRoom" BOOLEAN NOT NULL,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overriddenById" INTEGER,
    "overriddenAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_assignment_slots" (
    "assignmentId" INTEGER NOT NULL,
    "timeSlotId" INTEGER NOT NULL,

    CONSTRAINT "schedule_assignment_slots_pkey" PRIMARY KEY ("assignmentId","timeSlotId")
);

-- CreateTable
CREATE TABLE "fitness_history" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "bestFitness" DOUBLE PRECISION NOT NULL,
    "avgFitness" DOUBLE PRECISION NOT NULL,
    "hardViolations" INTEGER NOT NULL,
    "softPenalty" INTEGER NOT NULL,
    "competencyMismatch" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitness_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_runs_idempotencyKey_key" ON "schedule_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "schedule_runs_semesterId_idx" ON "schedule_runs"("semesterId");

-- CreateIndex
CREATE INDEX "schedule_runs_createdById_idx" ON "schedule_runs"("createdById");

-- CreateIndex
CREATE INDEX "schedule_runs_status_idx" ON "schedule_runs"("status");

-- CreateIndex
CREATE INDEX "schedule_runs_startedAt_idx" ON "schedule_runs"("startedAt");

-- CreateIndex
CREATE INDEX "schedule_assignments_runId_idx" ON "schedule_assignments"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_assignments_runId_offeringId_key" ON "schedule_assignments"("runId", "offeringId");

-- CreateIndex
CREATE INDEX "fitness_history_runId_idx" ON "fitness_history"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "fitness_history_runId_generation_key" ON "fitness_history"("runId", "generation");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_runId_fkey" FOREIGN KEY ("runId") REFERENCES "schedule_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment_slots" ADD CONSTRAINT "schedule_assignment_slots_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "schedule_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment_slots" ADD CONSTRAINT "schedule_assignment_slots_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "time_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fitness_history" ADD CONSTRAINT "fitness_history_runId_fkey" FOREIGN KEY ("runId") REFERENCES "schedule_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

