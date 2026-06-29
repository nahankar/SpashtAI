-- Per-user Ultra license flag (admin-controlled). Gates highest-tier features
-- such as Replay video-file uploads.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "enableUltra" BOOLEAN NOT NULL DEFAULT false;
