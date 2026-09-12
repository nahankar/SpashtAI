-- Deleting a user must remove their owned work. Journey delete still does not
-- remove Elevate sessions; that relationship stays on PreparationPractice.
ALTER TABLE "Preparation" DROP CONSTRAINT "Preparation_userId_fkey";
ALTER TABLE "Preparation" ADD CONSTRAINT "Preparation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplaySession" DROP CONSTRAINT "ReplaySession_userId_fkey";
ALTER TABLE "ReplaySession" ADD CONSTRAINT "ReplaySession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
