-- Old runs deliberately retain NULL: enabling the pilot never retroactively grades them.
ALTER TABLE "InterviewRun" ADD COLUMN "evaluationPolicySnapshot" JSONB;
INSERT INTO "PlatformFeatureFlag" (feature,label,description,audience,hidden,disabled,enabled,"updatedAt")
VALUES ('interview_adaptive','Interview technical evaluation · learner pilot',
  'Evaluate saved learner answers. Separate from the Admin evaluator; automatic voice progression is a later checkpoint.',
  'SELECTED_USERS',true,true,false,NOW()) ON CONFLICT (feature) DO NOTHING;
