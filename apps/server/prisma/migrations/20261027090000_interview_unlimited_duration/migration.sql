-- Plan practice times: 30 minutes (Pro/Ultra) and no time limit (NULL, Ultra). Additive: existing rows keep their
-- minutes, the column default stays 10, and the eight-question cap is unchanged.
ALTER TABLE "InterviewRun" ALTER COLUMN "durationMinutes" DROP NOT NULL;
ALTER TABLE "InterviewRun" DROP CONSTRAINT "InterviewRun_setup";
ALTER TABLE "InterviewRun" ADD CONSTRAINT "InterviewRun_setup" CHECK (
  namespace = 'automation-pilot'
  AND public.valid_interview_selection(track, ARRAY[]::TEXT[], 20, 160)
  AND public.valid_interview_selection("experienceBand", ARRAY['0-2','2-5','5-8','8+'], 4, 3)
  AND public.valid_interview_selection("startingDifficulty", ARRAY['Simple','Medium','Complex','Very Complex'], 4, 12)
  AND ("durationMinutes" IS NULL OR "durationMinutes" IN (5,10,15,30)) AND "maxQuestions" = 8
);
