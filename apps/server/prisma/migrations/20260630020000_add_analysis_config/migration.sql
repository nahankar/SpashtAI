-- Admin-configurable Replay/analysis LLM (singleton, id = 'default').
CREATE TABLE IF NOT EXISTS "AnalysisConfig" (
    "id" TEXT NOT NULL,
    "replayModelId" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisConfig_pkey" PRIMARY KEY ("id")
);
