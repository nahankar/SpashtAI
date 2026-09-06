-- CreateEnum
CREATE TYPE "PreparationType" AS ENUM ('INTERVIEW');

-- CreateEnum
CREATE TYPE "PreparationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'OFFERED', 'COMPLETED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PreparationStageType" AS ENUM ('APPLIED', 'RECRUITER', 'TECHNICAL', 'BEHAVIORAL', 'HIRING_MANAGER', 'CASE_ASSIGNMENT', 'LEADERSHIP', 'HR', 'OFFER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PreparationStageStatus" AS ENUM ('UPCOMING', 'SCHEDULED', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Preparation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PreparationType" NOT NULL DEFAULT 'INTERVIEW',
    "title" TEXT NOT NULL,
    "status" "PreparationStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPreparation" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "jobDescriptionText" TEXT,
    "interviewDate" TIMESTAMP(3),
    "resumeText" TEXT,
    "resumeLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationStage" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "type" "PreparationStageType" NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PreparationStageStatus" NOT NULL DEFAULT 'UPCOMING',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "interviewerName" TEXT,
    "interviewerRole" TEXT,
    "interviewerProfileText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparationStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Preparation_userId_idx" ON "Preparation"("userId");

-- CreateIndex
CREATE INDEX "Preparation_userId_status_idx" ON "Preparation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPreparation_preparationId_key" ON "InterviewPreparation"("preparationId");

-- CreateIndex
CREATE INDEX "PreparationStage_preparationId_sequence_idx" ON "PreparationStage"("preparationId", "sequence");

-- CreateIndex
CREATE INDEX "PreparationStage_preparationId_status_idx" ON "PreparationStage"("preparationId", "status");

-- AddForeignKey
ALTER TABLE "Preparation" ADD CONSTRAINT "Preparation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPreparation" ADD CONSTRAINT "InterviewPreparation_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationStage" ADD CONSTRAINT "PreparationStage_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
