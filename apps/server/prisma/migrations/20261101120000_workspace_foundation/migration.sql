-- CreateEnum
CREATE TYPE "public"."WorkspaceKind" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "public"."WorkspaceState" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."WorkspaceMemberRole" AS ENUM ('OWNER', 'ADMIN', 'LEARNER');

-- CreateEnum
CREATE TYPE "public"."WorkspaceMemberState" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."WorkspaceIsolationStage" AS ENUM ('PERSONAL_LEGACY', 'FOUNDATION_ONLY', 'TENANT_READY');

-- CreateEnum
CREATE TYPE "public"."WorkspaceStorageMode" AS ENUM ('SHARED', 'DEDICATED_DATABASE');

-- CreateTable
CREATE TABLE "public"."Workspace" (
    "id" TEXT NOT NULL,
    "kind" "public"."WorkspaceKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "public"."WorkspaceState" NOT NULL DEFAULT 'ACTIVE',
    "isolationStage" "public"."WorkspaceIsolationStage" NOT NULL DEFAULT 'FOUNDATION_ONLY',
    "personalOwnerId" TEXT,
    "logoDataUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "maxMembers" INTEGER NOT NULL DEFAULT 25,
    "dailyEvaluations" INTEGER NOT NULL DEFAULT 30,
    "concurrentVoice" INTEGER NOT NULL DEFAULT 2,
    "storageMode" "public"."WorkspaceStorageMode" NOT NULL DEFAULT 'SHARED',
    "databaseKey" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."WorkspaceMemberRole" NOT NULL DEFAULT 'LEARNER',
    "state" "public"."WorkspaceMemberState" NOT NULL DEFAULT 'INVITED',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkspaceFeature" (
    "workspaceId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "entitled" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "memberDefault" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceFeature_pkey" PRIMARY KEY ("workspaceId","feature")
);

-- CreateTable
CREATE TABLE "public"."WorkspaceMemberFeature" (
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMemberFeature_pkey" PRIMARY KEY ("workspaceId","memberId","feature")
);

-- CreateTable
CREATE TABLE "public"."WorkspaceAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "public"."Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_personalOwnerId_key" ON "public"."Workspace"("personalOwnerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_state_idx" ON "public"."WorkspaceMember"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "public"."WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_id_key" ON "public"."WorkspaceMember"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "WorkspaceAudit_workspaceId_createdAt_idx" ON "public"."WorkspaceAudit"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Workspace" ADD CONSTRAINT "Workspace_personalOwnerId_fkey" FOREIGN KEY ("personalOwnerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceFeature" ADD CONSTRAINT "WorkspaceFeature_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceMemberFeature" ADD CONSTRAINT "WorkspaceMemberFeature_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "public"."WorkspaceMember"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceMemberFeature" ADD CONSTRAINT "WorkspaceMemberFeature_workspaceId_feature_fkey" FOREIGN KEY ("workspaceId", "feature") REFERENCES "public"."WorkspaceFeature"("workspaceId", "feature") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkspaceAudit" ADD CONSTRAINT "WorkspaceAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariant checks also protect administrative scripts and future integrations.
ALTER TABLE "Workspace" ADD CONSTRAINT workspace_owner_kind CHECK (
  (kind='PERSONAL' AND "personalOwnerId" IS NOT NULL AND "isolationStage"='PERSONAL_LEGACY') OR
  (kind='ORGANIZATION' AND "personalOwnerId" IS NULL AND "isolationStage" <> 'PERSONAL_LEGACY'));
ALTER TABLE "Workspace" ADD CONSTRAINT workspace_limits CHECK (
  "maxMembers" BETWEEN 1 AND 100000 AND "dailyEvaluations" BETWEEN 0 AND 100000 AND "concurrentVoice" BETWEEN 1 AND 1000);
ALTER TABLE "WorkspaceFeature" ADD CONSTRAINT workspace_feature_entitled CHECK (NOT enabled OR entitled);
ALTER TABLE "WorkspaceFeature" ADD CONSTRAINT workspace_feature_catalog CHECK (
  feature IN ('coach','elevate','replay','interviews','prepare','progress_pulse','feedback','pro','ultra','audio_export','text_export','reprocess'));
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT workspace_member_accepted CHECK (state <> 'ACTIVE' OR "acceptedAt" IS NOT NULL);

-- Existing records remain user-owned. Only membership metadata is backfilled.
INSERT INTO "Workspace" (id,kind,slug,name,"personalOwnerId","isolationStage","maxMembers","updatedAt")
SELECT 'personal_'||id,'PERSONAL','personal-'||lower(id),'Personal',id,'PERSONAL_LEGACY',1,CURRENT_TIMESTAMP FROM "User";
INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role,state,"acceptedAt","updatedAt")
SELECT 'personal_member_'||id,'personal_'||id,id,'OWNER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM "User";

-- Runtime must use a NOSUPERUSER NOBYPASSRLS role. The API refuses workspace
-- requests with a bypass role. Context is set only inside explicit transactions.
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMember" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceFeature" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMemberFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMemberFeature" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceAudit" FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_read ON "Workspace" FOR SELECT USING (
  current_setting('app.workspace_platform_admin',true)='true' OR
  "personalOwnerId"=current_setting('app.workspace_actor_id',true) OR EXISTS (
    SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId"="Workspace".id
    AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state <> 'SUSPENDED'));
CREATE POLICY workspace_insert ON "Workspace" FOR INSERT WITH CHECK (
  current_setting('app.workspace_platform_admin',true)='true' OR
  (kind='PERSONAL' AND "personalOwnerId"=current_setting('app.workspace_actor_id',true) AND "isolationStage"='PERSONAL_LEGACY'));
CREATE POLICY workspace_update ON "Workspace" FOR UPDATE USING (
  current_setting('app.workspace_platform_admin',true)='true' OR id=current_setting('app.workspace_id',true))
  WITH CHECK (current_setting('app.workspace_platform_admin',true)='true' OR id=current_setting('app.workspace_id',true));
CREATE POLICY membership_read ON "WorkspaceMember" FOR SELECT USING (
  current_setting('app.workspace_platform_admin',true)='true' OR
  "userId"=current_setting('app.workspace_actor_id',true) OR "workspaceId"=current_setting('app.workspace_id',true));
CREATE POLICY membership_insert ON "WorkspaceMember" FOR INSERT WITH CHECK (
  current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true) OR
  ("userId"=current_setting('app.workspace_actor_id',true) AND EXISTS (
    SELECT 1 FROM "Workspace" w WHERE w.id="workspaceId" AND w.kind='PERSONAL' AND w."personalOwnerId"="userId")));
CREATE POLICY membership_update ON "WorkspaceMember" FOR UPDATE USING (
  current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true))
  WITH CHECK (current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true));
CREATE POLICY workspace_features ON "WorkspaceFeature" FOR ALL USING (
  current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true))
  WITH CHECK (current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true));
CREATE POLICY member_features ON "WorkspaceMemberFeature" FOR ALL USING (
  current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true))
  WITH CHECK (current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true));
CREATE POLICY workspace_audit_read ON "WorkspaceAudit" FOR SELECT USING (
  current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true));
CREATE POLICY workspace_audit_append ON "WorkspaceAudit" FOR INSERT WITH CHECK (
  "actorUserId"=current_setting('app.workspace_actor_id',true) AND (
    current_setting('app.workspace_platform_admin',true)='true' OR "workspaceId"=current_setting('app.workspace_id',true)));
