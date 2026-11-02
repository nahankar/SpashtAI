-- Additive metadata on existing FORCE-RLS tables; no new bypass paths.
ALTER TABLE "Workspace" ADD COLUMN "enrollmentSettings" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "WorkspaceMember" ADD COLUMN "enrollmentResponses" jsonb NOT NULL DEFAULT '{}', ADD COLUMN "enrollmentFields" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "UserInvitation" ADD COLUMN "enrollmentFields" jsonb NOT NULL DEFAULT '[]', ADD COLUMN "emailSubject" text, ADD COLUMN "emailMessage" text;
ALTER TABLE "Workspace" ADD CONSTRAINT workspace_enrollment_object CHECK (jsonb_typeof("enrollmentSettings")='object');
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT member_enrollment_shape CHECK (jsonb_typeof("enrollmentResponses")='object' AND jsonb_typeof("enrollmentFields")='array');
ALTER TABLE "UserInvitation" ADD CONSTRAINT invitation_enrollment_shape CHECK (jsonb_typeof("enrollmentFields")='array' AND length(coalesce("emailSubject",''))<=150 AND length(coalesce("emailMessage",''))<=5000);
-- Resends retain the exact form and message originally approved for this invitation.
CREATE FUNCTION public.protect_invitation_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."enrollmentFields" IS DISTINCT FROM OLD."enrollmentFields" OR NEW."emailSubject" IS DISTINCT FROM OLD."emailSubject" OR NEW."emailMessage" IS DISTINCT FROM OLD."emailMessage" THEN
 RAISE EXCEPTION 'Invitation form and email snapshot are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invitation_enrollment_snapshot BEFORE UPDATE ON "UserInvitation" FOR EACH ROW EXECUTE FUNCTION public.protect_invitation_enrollment();
