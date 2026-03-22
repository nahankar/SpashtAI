-- DropIndex
DROP INDEX "public"."SessionRecording_sessionId_key";

-- AlterTable
ALTER TABLE "public"."SessionRecording" ADD COLUMN     "recordingType" TEXT NOT NULL DEFAULT 'user';
