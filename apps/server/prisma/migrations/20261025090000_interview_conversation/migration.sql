-- Automatic interview conversation (Phase 3.3b). Additive: existing runs keep NULL and stay manual.
-- InterviewRun rows are immutable by trigger, so the pin can only be written at insert.
ALTER TABLE "InterviewRun" ADD COLUMN "conversationPolicySnapshot" JSONB;
INSERT INTO "PlatformFeatureFlag" (feature,label,description,audience,hidden,disabled,enabled,"updatedAt")
VALUES ('interview_conversation','Interview conversation · learner pilot',
  'Automatic answer completion and next question in new interview practices. Finish, Skip and Next stay as fallbacks. Requires Interviews and Interview voice access.',
  'SELECTED_USERS',true,true,false,NOW()) ON CONFLICT (feature) DO NOTHING;
