-- Reprocessing is an opt-in, individual capability. New accounts start with it disabled.
ALTER TABLE "User" ALTER COLUMN "enableReprocess" SET DEFAULT false;

-- Revoke the legacy global default. An administrator can explicitly enable the
-- capability for each approved user from Admin > User details.
UPDATE "User" SET "enableReprocess" = false;
