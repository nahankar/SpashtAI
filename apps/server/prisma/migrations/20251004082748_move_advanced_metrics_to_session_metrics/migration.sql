/*
  Warnings:

  - You are about to drop the column `advancedMetrics` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `fillerRate` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `words` on the `Session` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Session" DROP COLUMN "advancedMetrics",
DROP COLUMN "fillerRate",
DROP COLUMN "words";

-- AlterTable
ALTER TABLE "public"."SessionMetrics" ADD COLUMN     "contentMetrics" JSONB,
ADD COLUMN     "deliveryMetrics" JSONB,
ADD COLUMN     "performanceInsights" JSONB,
ADD COLUMN     "processingStatus" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
