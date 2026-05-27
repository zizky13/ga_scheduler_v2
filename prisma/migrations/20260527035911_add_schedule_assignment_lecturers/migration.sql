-- CreateTable
CREATE TABLE "schedule_assignment_lecturers" (
    "runId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "lecturerId" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_assignment_lecturers_pkey" PRIMARY KEY ("assignmentId","lecturerId")
);

-- CreateIndex
CREATE INDEX "schedule_assignment_lecturers_runId_idx" ON "schedule_assignment_lecturers"("runId");

-- CreateIndex
CREATE INDEX "schedule_assignment_lecturers_lecturerId_idx" ON "schedule_assignment_lecturers"("lecturerId");

-- AddForeignKey
ALTER TABLE "schedule_assignment_lecturers" ADD CONSTRAINT "schedule_assignment_lecturers_runId_fkey" FOREIGN KEY ("runId") REFERENCES "schedule_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment_lecturers" ADD CONSTRAINT "schedule_assignment_lecturers_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "schedule_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment_lecturers" ADD CONSTRAINT "schedule_assignment_lecturers_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
