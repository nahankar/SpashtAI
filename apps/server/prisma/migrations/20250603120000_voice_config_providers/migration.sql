-- Add composable STT/TTS provider fields for pipeline-bedrock
ALTER TABLE "VoiceConfig" ADD COLUMN IF NOT EXISTS "sttProvider" TEXT;
ALTER TABLE "VoiceConfig" ADD COLUMN IF NOT EXISTS "ttsProvider" TEXT;
