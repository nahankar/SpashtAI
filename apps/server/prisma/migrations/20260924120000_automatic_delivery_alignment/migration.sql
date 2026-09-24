ALTER TABLE "Session"
  ADD COLUMN "deliveryAlignmentStatus" TEXT,
  ADD COLUMN "deliveryAlignmentAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryAlignmentNextAt" TIMESTAMP(3),
  ADD COLUMN "deliveryAlignmentError" TEXT,
  ADD COLUMN "deliveryAlignmentResult" JSONB;
-- Set the default only after adding the column, preserving NULL for old rows.
ALTER TABLE "Session" ALTER COLUMN "deliveryAlignmentStatus" SET DEFAULT 'pending';
CREATE INDEX "Session_deliveryAlignmentStatus_deliveryAlignmentNextAt_idx"
  ON "Session"("deliveryAlignmentStatus", "deliveryAlignmentNextAt");
CREATE TABLE "DeliveryAlignmentLease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "owner" TEXT,
  "expiresAt" TIMESTAMP(3)
);
INSERT INTO "DeliveryAlignmentLease" ("id") VALUES ('automatic');
