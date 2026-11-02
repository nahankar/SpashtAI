-- Platform learner invitations: hashed single-use tokens, one pending invitation per address (pendingKey),
-- and delivery status kept apart from invitation status. No tenant scope yet.
-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'DEV_CAPTURED');

-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "recipientName" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "pendingKey" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "existingUserAtInvite" BOOLEAN NOT NULL DEFAULT false,
    "deliveryStatus" "InvitationDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "deliveryError" TEXT,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_pendingKey_key" ON "UserInvitation"("pendingKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvitation_status_expiresAt_idx" ON "UserInvitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "UserInvitation_email_idx" ON "UserInvitation"("email");

-- CreateIndex
CREATE INDEX "UserInvitation_createdAt_idx" ON "UserInvitation"("createdAt");

