# Data ownership inventory

Reviewed against branch `codex/workspace-product-access` (November 3, 2026). “Pending” is a release blocker for that product,
not permission to reuse a user-only query. Shared login identity never implies shared activity history.

| Models | Ownership boundary | Current state / next requirement |
| --- | --- | --- |
| User | Global identity | Keep credentials/profile global. Workspace roles never change platform role. Review global license/export flags before tenant delegation. |
| Workspace, WorkspaceMember, WorkspaceFeature, WorkspaceMemberFeature, WorkspaceAudit | Workspace control plane | RLS, current membership, entitlement ceiling and content-free audit implemented. |
| UserInvitation | Optional organization scope + proposed membership | Integrated shared mailer, immutable scope/role, RLS, token-bound acceptance, current inviter permissions, seat reservations, content-free WorkspaceAudit and tenant retention/deletion. Null scope remains platform-only. |
| Session | Workspace + learner | Immutable workspace ID/kind/user ID; existing and legacy-created activity is Personal. Forced RLS; Owner/Admin aggregate read in manager mode only. |
| SessionMetrics, SessionTranscript, SessionSegment, SessionTurn, SessionRecording | Inherited from Session | RLS through parent; never visible in manager mode. Organization files under `workspaces/<workspace>/sessions/<session>/`. |
| Preparation, InterviewPreparation, PreparationStage, InterviewQuestion, StageReflection | Workspace + learner through Preparation | Root ownership, forced RLS and parent policies implemented and tested. Prepare is not offered in organizations (readiness false). |
| PreparationPractice, PreparationRecording | Preparation + Session / ReplaySession | Both parents must share workspace and learner (link trigger); links are immutable. Tested. |
| ReplaySession, ReplayUpload, ReplayResult | Workspace + learner through ReplaySession | Implemented and tested: prefixed uploads and storage keys, plan gates, outbox scope, playback, export and deletion. Raw children never visible in manager mode. |
| ReplayDeletion | Durable storage cleanup | Carries `workspaceId` for attribution after the parent is gone; cleanup runs in a verified cleanup scope. |
| ProgressPulse | Workspace + learner + source record | Root ownership plus same-workspace source links. Owner/Admin report reads aggregates only, bucketed in the organization time zone. |
| FeatureUsage | Workspace product events | Root ownership; browser events are recorded in the open workspace. Owner/Admin aggregate read. |
| UserActivity | Global authentication events | Stays global (sign-in activity). Not used for workspace reports. |
| CoachThread, CoachTurn, CoachAction | Workspace + learner through CoachThread | Data isolation implemented. Coach is Personal-only: `/api/coach` refuses a workspace scope (403 `WORKSPACE_FEATURE_UNAVAILABLE`). |
| CoachHomeResultReceipt | Workspace + learner + target record | Root ownership implemented; Personal-only with Coach. |
| InterviewRun, InterviewAttempt, InterviewCaptureReceipt, InterviewAnswerChunk, InterviewTranscriptIssue | Through Session → InterviewRun → InterviewAttempt | Parent policies; same-session and same-run checks. Tested with organization runs. |
| InterviewAnswerSnapshot, InterviewAssessment | Learner answer and evaluation | Attempt-scoped; platform evaluator tests (no attempt) are never visible inside an organization. Grading models and prompts unchanged. |
| InterviewEvaluatorUsage, InterviewEvaluatorBudget | Content-free metering | Usage carries optional `workspaceId` under forced RLS. Organization budget is `Workspace.dailyEvaluations` on the organization day; per-learner allowance counted per workspace. Platform cap `learner-global` is shared. |
| BankFollowUpJob | Source Session + controlled shared publication | Parent policy through Session. Organization content does not enter the global question bank. |
| QuestionBankQuestion, QuestionImportBatch, QuestionImportRow | Platform-shared authoring today | Keep platform-only. Tenant-private banks require an explicit namespace/visibility model and authorization before use. |
| RecordingAcknowledgment | Workspace + learner | Root ownership; unique per (workspace, user, version), so a Personal acceptance never carries into an organization. |
| UserFeedback, UserFeedbackAttachment, UserFeedbackNote | Workspace + learner; platform staff handling | Root ownership; attachments under the workspace prefix; numbers from a database sequence. Owner/Admin list excludes session links and attachments. Platform staff handle all feedback in the audited platform context; staff notes are not tenant-visible. |
| AdminAction, AdminAnalyticsQuery | Global platform administration | Platform-only. |
| WorkspaceAnalyticsQuery | Workspace (saved Owner/Admin report plans) | Forced RLS. Plans are allowlisted report definitions; learners bound to members of the same workspace. |
| SystemMetrics | Global operations | Platform-only aggregates/health; not a tenant usage report. |
| DeliveryAlignmentLease | Shared operational lease | Global resource lock is valid. Each claimed Session/job must nevertheless carry and re-establish workspace context. Default worker scans currently cannot see organization Sessions. |
| PlatformFeatureFlag, UserFeatureGrant | Platform availability / account pilot grants | Global control plane. Tenant settings may only narrow access; selected-user grants must also be checked. |
| AgentPrompt, VoiceConfig, AnalysisConfig | Platform configuration today | Keep platform-only. Tenant customization requires explicit inheritance, versioning and workspace-bound agent dispatch. |
| PlatformTicker, PlatformSettings, PricingSettings, PricingPlan, PricingPlanFeature, LegalDocument | Global product configuration | Keep platform-only. Per-workspace billing, branding and custom policies must be explicitly modeled rather than editing global records. |

## Boundaries beyond database rows

- **Agent.** Room and dispatch metadata carry a signed agent scope (36 h, audience `agent-callback`); callbacks return
  it and the server honours it only with the internal agent token and only for the named session. Tested in unit and
  database tests; not yet with a real LiveKit room.
- **WebSocket.** Organization subscriptions require the workspace token; membership is rechecked on every event.
- **Media.** Organization files live under the workspace prefix; reads reject foreign paths and symlinks. Browser
  playback uses a two-hour media ticket bound to one session (`workspace_media`); the workspace token never enters a URL.
- **Jobs.** Each claim re-establishes a fresh verified scope per (workspace, learner); ended memberships stop processing.
- **Analytics.** Workspace reports, filters, learner selectors and saved plans are workspace-scoped and Owner/Admin only.
  Platform Admin analytics run without a workspace context and show Personal activity only.
- **Browser.** The workspace token is held in memory only. Resumable-session keys are namespaced per workspace; uploads
  and live-update subscriptions stay bound to the workspace they started in; leaving a workspace clears its context.
- **Quotas.** Voice concurrency (advisory lock plus open-segment count) and daily evaluation budgets are enforced at
  the operation boundary; seat limits at invitation creation and acceptance.
- **Dedicated databases.** Not provisioned; non-primary placements fail closed.
