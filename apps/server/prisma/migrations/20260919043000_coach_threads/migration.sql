-- CreateTable
CREATE TABLE "CoachThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preparationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT,
    "text" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAction" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachThread_userId_updatedAt_idx" ON "CoachThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachThread_userId_status_idx" ON "CoachThread"("userId", "status");

-- CreateIndex
CREATE INDEX "CoachTurn_threadId_createdAt_idx" ON "CoachTurn"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachAction_threadId_createdAt_idx" ON "CoachAction"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachAction_targetId_idx" ON "CoachAction"("targetId");

-- AddForeignKey
ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachTurn" ADD CONSTRAINT "CoachTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAction" ADD CONSTRAINT "CoachAction_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
