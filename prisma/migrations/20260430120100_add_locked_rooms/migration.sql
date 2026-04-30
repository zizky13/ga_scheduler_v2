-- CreateTable
CREATE TABLE "locked_rooms" (
    "id" SERIAL NOT NULL,
    "semesterId" INTEGER NOT NULL,
    "offeringId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "lockedById" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "locked_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locked_rooms_offeringId_key" ON "locked_rooms"("offeringId");

-- CreateIndex
CREATE INDEX "locked_rooms_semesterId_idx" ON "locked_rooms"("semesterId");

-- CreateIndex
CREATE INDEX "locked_rooms_roomId_idx" ON "locked_rooms"("roomId");

-- AddForeignKey
ALTER TABLE "locked_rooms" ADD CONSTRAINT "locked_rooms_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locked_rooms" ADD CONSTRAINT "locked_rooms_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locked_rooms" ADD CONSTRAINT "locked_rooms_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locked_rooms" ADD CONSTRAINT "locked_rooms_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

