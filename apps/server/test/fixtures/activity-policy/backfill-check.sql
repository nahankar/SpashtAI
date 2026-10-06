DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Session" WHERE id='legacy-profile' AND purpose='COMMUNICATION' AND "contextScope"='COMMUNICATION_PROFILE') THEN RAISE EXCEPTION 'Profile backfill failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Session" WHERE id='legacy-owned' AND purpose='INTERVIEW' AND "contextScope"='JOURNEY') THEN RAISE EXCEPTION 'Journey backfill failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReplaySession" WHERE id='legacy-replay' AND purpose='INTERVIEW' AND "contextScope"='JOURNEY') THEN RAISE EXCEPTION 'Recording backfill failed'; END IF;
END $$;
