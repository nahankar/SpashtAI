-- Per-user Pro license flag (admin-controlled). Gates premium UI features.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "enablePro" BOOLEAN NOT NULL DEFAULT false;
