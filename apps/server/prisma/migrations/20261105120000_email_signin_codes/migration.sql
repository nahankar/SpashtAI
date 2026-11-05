CREATE TABLE "EmailSignInCode" (
  "email" TEXT PRIMARY KEY,
  "challengeId" TEXT NOT NULL UNIQUE,
  "contextHash" TEXT NOT NULL,
  "codeHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "sends" INTEGER NOT NULL DEFAULT 0
);
