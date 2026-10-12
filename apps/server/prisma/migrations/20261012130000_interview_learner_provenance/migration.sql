-- Preserve all existing approvals/activation. Learner eligibility additionally
-- requires an explicit confirmation; imports/AI authorship never supply it.
ALTER TABLE "QuestionBankQuestion"
  ADD COLUMN "provenanceNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "provenanceConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "provenanceConfirmedById" TEXT;
ALTER TABLE "QuestionBankQuestion" ADD CONSTRAINT "QuestionBankQuestion_provenanceConfirmedById_fkey"
  FOREIGN KEY ("provenanceConfirmedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionBankQuestion" ADD CONSTRAINT "QuestionBankQuestion_provenance_state"
  CHECK (("provenanceConfirmedAt" IS NULL AND "provenanceNote"='' AND "provenanceConfirmedById" IS NULL)
    OR ("provenanceConfirmedAt" IS NOT NULL AND length(trim("provenanceNote")) BETWEEN 20 AND 2000));
CREATE FUNCTION clear_changed_bank_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['revision','approved','active','approvedAt','approvedById','updatedAt','importHash','createdById','provenanceNote','provenanceConfirmedAt','provenanceConfirmedById'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revision','approved','active','approvedAt','approvedById','updatedAt','importHash','createdById','provenanceNote','provenanceConfirmedAt','provenanceConfirmedById']) THEN
    NEW."provenanceNote" := '';
    NEW."provenanceConfirmedAt" := NULL;
    NEW."provenanceConfirmedById" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "QuestionBankQuestion_reset_provenance" BEFORE UPDATE ON "QuestionBankQuestion"
  FOR EACH ROW EXECUTE FUNCTION clear_changed_bank_provenance();
CREATE INDEX "QuestionBankQuestion_learner_eligible" ON "QuestionBankQuestion"(track,difficulty)
  WHERE active AND approved AND "verbalSuitable" AND "provenanceConfirmedAt" IS NOT NULL;
