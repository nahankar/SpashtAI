# Data ownership inventory

Reviewed against the tenancy branch schema (63 models). “Pending” is a release blocker for that product,
not permission to reuse a user-only query. Shared login identity never implies shared activity history.

| Models | Ownership boundary | Current state / next requirement |
| --- | --- | --- |
| User | Global identity | Keep credentials/profile global. Workspace roles never change platform role. Review global license/export flags before tenant delegation. |
| Workspace, WorkspaceMember, WorkspaceFeature, WorkspaceMemberFeature, WorkspaceAudit | Workspace control plane | RLS, current membership, entitlement ceiling and content-free audit implemented. |
| UserInvitation | Optional organization scope + proposed membership | Integrated shared mailer, immutable scope/role, RLS, token-bound acceptance, current inviter permissions, seat reservations, content-free WorkspaceAudit and tenant retention/deletion. Null scope remains platform-only. |
| Session | Workspace + learner | Immutable workspace ID/kind/user ID; existing and legacy-created activity is Personal. RLS implemented. |
| SessionMetrics, SessionTranscript, SessionSegment, SessionTurn, SessionRecording | Inherited from Session | RLS through parent, immutable session links, same-session segment validation implemented. Recording files additionally need workspace/session/recording namespaces. |
| Preparation, InterviewPreparation, PreparationStage, InterviewQuestion, StageReflection | Workspace + learner through Preparation | Pending. Add root workspace ownership; round/stage/journey consistency; scope every list and transition. |
| PreparationPractice | Preparation + Session | Pending. Both parents must share workspace and learner. Organization Session links currently rejected. |
| PreparationRecording | Preparation + ReplaySession | Pending. Both parents must share workspace and learner; include deletion/recovery paths. |
| ReplaySession, ReplayUpload, ReplayResult | Workspace + learner through ReplaySession | Pending. Raw input, selected speaker, transcript, audio/video objects, metrics and exports share one boundary. |
| ReplayDeletion | Durable workspace-owned storage cleanup | Pending. Preserve workspace/object identity after parent deletion, with scoped deletion authorization and retry claims. |
| ProgressPulse | Workspace + learner + source record | Pending. Elevate/Replay provenance and day-wise aggregation must share workspace. Organization Elevate links currently rejected. No tenant score aggregation yet. |
| FeatureUsage, UserActivity | Split global authentication events from workspace product events | Pending. Add explicit workspace attribution to product activity, retaining global sign-in events separately. Workspace UI currently excludes Personal engagement telemetry. |
| CoachThread, CoachTurn, CoachAction | Workspace + learner through CoachThread | Pending. Cross-feature target/preparation references must be in the same workspace. Organization Elevate action links currently rejected. |
| CoachHomeResultReceipt | Workspace + learner + target record | Pending. Receipt uniqueness, cache keys and targets must include workspace. |
| InterviewRun | Workspace + learner through Session | Pending. Organization Session association rejected until all descendants/agent paths are scoped. |
| InterviewAttempt, InterviewCaptureReceipt, InterviewAnswerChunk, InterviewTranscriptIssue | Through InterviewRun and SessionSegment | Pending. Attempt/run/segment must identify the same Session; parent/follow-up attempts must share run. |
| InterviewAnswerSnapshot, InterviewAssessment | Learner answer and evaluation scope | Pending. Live/recording answers inherit attempt workspace; Admin tests stay separate. Preserve immutable answer/evaluation provenance and ownership. |
| InterviewEvaluatorUsage, InterviewEvaluatorBudget | Content-free metering with explicit account/workspace scope | Pending. Tenant budgets cannot reuse Personal/global counters; retain safe accounting after answer deletion. |
| BankFollowUpJob | Source Session + controlled shared publication | Pending. Organization Session links currently rejected. Tenant content must not silently enter the global question bank. |
| QuestionBankQuestion, QuestionImportBatch, QuestionImportRow | Platform-shared authoring today | Keep platform-only. Tenant-private banks require an explicit namespace/visibility model and authorization before use. |
| RecordingAcknowledgment | Global identity acknowledgement + per-practice provenance | Global record remains private to identity/platform operations. Future tenant practice records must stamp workspace-aware consent provenance; a tenant Admin cannot browse Personal acknowledgements. |
| UserFeedback, UserFeedbackAttachment, UserFeedbackNote | Product feedback scope + global staff handling | Pending. Classify originating workspace, file access and tenant-visible responses before tenant feedback is enabled. Global staff notes must not become tenant-visible by default. |
| AdminAction, AdminAnalyticsQuery | Global platform administration | Keep platform-only. Tenant analytics queries/audits need separate explicit scope and catalog; never reuse global Admin query execution for a workspace Admin. |
| SystemMetrics | Global operations | Platform-only aggregates/health; not a tenant usage report. |
| DeliveryAlignmentLease | Shared operational lease | Global resource lock is valid. Each claimed Session/job must nevertheless carry and re-establish workspace context. Default worker scans currently cannot see organization Sessions. |
| PlatformFeatureFlag, UserFeatureGrant | Platform availability / account pilot grants | Global control plane. Tenant settings may only narrow access; selected-user grants must also be checked. |
| AgentPrompt, VoiceConfig, AnalysisConfig | Platform configuration today | Keep platform-only. Tenant customization requires explicit inheritance, versioning and workspace-bound agent dispatch. |
| PlatformTicker, PlatformSettings, PricingSettings, PricingPlan, PricingPlanFeature, LegalDocument | Global product configuration | Keep platform-only. Per-workspace billing, branding and custom policies must be explicitly modeled rather than editing global records. |

## Boundaries beyond database rows

- Agent room/dispatch metadata and callbacks must bind workspace, learner, session and segment. A shared agent
  secret does not identify a tenant. Pending; organization voice creation remains unavailable.
- WebSocket Personal subscriptions now require identity proof and recheck owner/tombstone before broadcast.
  Tenant subscriptions remain unavailable until the live-session data path is certified.
- New archive recording keys contain workspace/session/recording. Local reads reject foreign paths and symlinks.
  Remote object reads, upload initiation, egress paths, media-capability URLs and storage cleanup remain pending.
- Job claim, retry, lease, result persistence and cleanup must re-establish transaction-local scope. Tenant
  work must never inherit another request's pooled connection context. Pending for organization workflows.
- Saved analytics plans, reports, learner selectors, downloads and date boundaries need workspace filters
  and role checks. A hidden sidebar is not authorization. Pending.
- Browser recovery journals, IndexedDB, local/session storage, query caches and audio blobs need workspace
  keys. A workspace switch must not resume a Personal recording or reuse another workspace's transcript. Pending.
- Workspace invitations reuse the integrated service. Tenant invitations and tokens stay out of platform
  lists and the platform development mailbox. Google-only acceptance is locally tested with verified fixture
  identities; live Google acceptance and production email delivery remain unverified.
- Tenant limits are currently configuration. Enforce budgets, concurrency, retention and plan entitlements
  at the operation boundary before any organization practice launch.
- Dedicated database routing is not provisioned: the current placement check refuses non-primary databases.
  Extraction must move descendants, files, jobs and accounting together and include backup/rollback checks.
