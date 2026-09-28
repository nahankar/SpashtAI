-- New accounts get Pro, Ultra, and Reprocess Audio. Existing accounts get the same access.
ALTER TABLE "User" ALTER COLUMN "enablePro" SET DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "enableUltra" SET DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "enableReprocess" SET DEFAULT true;
UPDATE "User"
SET "enablePro" = true,
    "enableUltra" = true,
    "enableReprocess" = true;

-- The points balance stays stored, but awards and the header display stay off
-- until an admin enables them. Points do not grant Pro or Ultra.
ALTER TABLE "PlatformSettings"
ADD COLUMN "rewardPointsEnabled" BOOLEAN NOT NULL DEFAULT false;
