-- Hush is opt-in. Existing VoiceConfig rows remain on the current raw-audio
-- baseline after this migration.
ALTER TABLE "VoiceConfig"
ADD COLUMN IF NOT EXISTS "hushEnabled" BOOLEAN NOT NULL DEFAULT false;
