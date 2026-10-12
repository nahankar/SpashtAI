-- Additive follow-up: the preceding migrations have already run locally.
DROP TRIGGER "Session_interview_run_policy" ON "Session";
CREATE TRIGGER "Session_interview_run_policy"
  BEFORE UPDATE OF "userId", purpose, "contextScope", module ON "Session"
  FOR EACH ROW EXECUTE FUNCTION preserve_interview_session();

CREATE OR REPLACE FUNCTION clear_changed_bank_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Review notes are private editorial metadata. Generation/provenance notes
  -- remain significant: changing the stated content origin invalidates proof.
  IF (to_jsonb(NEW) - ARRAY['revision','approved','active','approvedAt','approvedById','updatedAt','importHash','createdById','reviewNotes','provenanceNote','provenanceConfirmedAt','provenanceConfirmedById'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revision','approved','active','approvedAt','approvedById','updatedAt','importHash','createdById','reviewNotes','provenanceNote','provenanceConfirmedAt','provenanceConfirmedById']) THEN
    NEW."provenanceNote" := '';
    NEW."provenanceConfirmedAt" := NULL;
    NEW."provenanceConfirmedById" := NULL;
  END IF;
  RETURN NEW;
END $$;
