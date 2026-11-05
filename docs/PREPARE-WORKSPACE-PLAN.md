# Prepare in organization workspaces — milestone plan (planning only)

Status 4 November 2026. Nothing here is implemented or enabled. Do not flip
`WORKSPACE_FEATURE_READINESS.prepare` (apps/server/src/workspaces/productAccess.ts) on its own.

## Verified current state (main 17f4bb3)

| Area | State |
|---|---|
| Data plane | `Preparation.workspaceId/workspaceKind` + RLS exist (Checkpoint 7 "data only"). Children (`PreparationStage`, `InterviewQuestion`, `StageReflection`, `InterviewPreparation`, `PreparationPractice`, `PreparationRecording`) hang off `Preparation` |
| API guard | `/api/preparations` is mounted with platform `requireFeature('prepare')` only — **no** `requireWorkspaceProduct('prepare')`, unlike Coach (`requireWorkspaceProduct('coach')`) |
| Readiness | `prepare: false`, `coach: false`; Northwind/production orgs have `prepare` entitlement off |
| Web | `WORKSPACE_PRODUCTS = ['elevate','replay','interviews']` (FeatureFlagsContext) hides Prepare in orgs; no `/w/:slug/prepare/*` routes or nav |
| Linked practices | `PreparationPractice.sessionId` (Elevate `Session`) and `PreparationRecording.replaySessionId` (`ReplaySession`); journey-owned Elevate sessions get `purpose='INTERVIEW'` (activityPolicy.ts) |
| Deletion | `ReplayDeletion.workspaceId` is nullable; journey delete must stamp it so the org-scoped cleanup worker can find files |
| Analytics | Org reports bucket journey Elevate practice under Interviews (purpose INTERVIEW) — Prepare activity is not attributable |
| Session review | Review migration excludes Prepare-linked sessions and has no policy on `Preparation` (by design, see M3b) |

## Scope reconciliation (why estimates differed)

* **8–15 dev-days** = smallest release: org-scoped journeys, stages, questions, reflections, linked Elevate/Replay
  practice inside the org, deletion/recovery, navigation, permission/RLS tests, analytics attribution.
* **+2–4 dev-days (M3b)** if organization Owners/Admins must be able to review Prepare journeys at launch; otherwise
  Prepare-linked practices stay excluded from review (current behaviour) and M3b follows separately.
* **3–5 weeks** additionally assumed: Coach-in-org (Coach consumes Prepare context), Owner/Admin review of journeys,
  exports, org-managed journey templates. These are separable and are **not** in the smallest release.
* Remaining uncertainty: analytics semantics (new `PREPARE` purpose vs. a link-based attribution), and
  deletion worker behaviour for mixed Personal/org history. No date is promised from either estimate.

## Milestones (each independently reviewable; none enables production)

**M1 — Server isolation proof (2–3 days)**
* `workspace-prepare-database.test.ts` mirroring `workspace-replay-database.test.ts`: two orgs + Personal,
  restricted role, known-ID probing on every `/api/preparations` route (list/get/patch/delete, stages, questions,
  reflections, practices, discard, log-interview).
* Mount `requireWorkspaceProduct('prepare')` (keeps Personal behaviour identical); journey creation in an org stamps
  `workspaceId/workspaceKind`; linked Elevate/Replay practice created from an org journey must be in the same org.
* Journey delete stamps `ReplayDeletion.workspaceId`; worker test proves org files are removed and Personal untouched.
* Acceptance: all routes 404 across orgs/Personal; suspended member/workspace refused; Personal suite unchanged.

**M2 — Org UI shell (2–4 days)**
* `/w/:slug/prepare/*` routes + nav entry gated by entitlement; include `prepare` in web `WORKSPACE_PRODUCTS`
  only behind readiness; deep-link/refresh coverage; linked practice launches stay in the org.
* Acceptance: browser walkthrough (fictional accounts) Personal ↔ org switching without leakage; real-audio Elevate
  practice launched from an org journey passes the voice tool (`elevate-learner`), transcript/recording saved in org.

**M3 — Analytics attribution (2–4 days)**
* Decide attribution (recommended: link-based — practice with a `PreparationPractice` row counts as Prepare —
  avoids changing `purpose` semantics for existing data). Update org reports + learner report + exports per
  `.cursor/rules/export-sync.mdc` if fields change.
* Acceptance: Prepare activity no longer counted as Interviews; historical numbers unchanged for Personal.

**M3b — Prepare in workspace session review (2–4 days; separate migration)**
* The session-review migration (`20261104120000_workspace_session_review`) deliberately **excludes** Prepare:
  `workspace_review_excludes_prepare()` hides any `Session` with a `PreparationPractice` row and any `ReplaySession`
  with a `PreparationRecording` row, and reviewers cannot see `Preparation` or its children at all. Nothing becomes
  reviewable automatically after M1–M2.
* Work: a new migration that (a) lifts the exclusion for journey-linked practices only for organization journeys whose
  `Preparation.workspaceId` matches, (b) adds a reviewer SELECT policy on `Preparation` and an explicit decision per
  child table (`PreparationStage`, `InterviewQuestion`, `StageReflection` — reflections may be private by design),
  (c) review API/UI showing the journey context with an explicit field allowlist, (d) product attribution in the review
  list (Prepare vs Elevate/Replay) consistent with M3.
* Tests: restricted-role DB tests for two organizations + Personal (Personal journeys never visible), role demotion,
  suspension, Prepare-linked practice visible only to the owning organization's Owner/Admin, reflections hidden or shown
  per the product decision, read-only enforcement, content-free audit; browser playback of a journey-linked recording.
* Acceptance: a reviewer sees an organization learner's journey practices with Prepare attribution; Personal and other
  organizations' journeys stay invisible; no write path exists.

**M4 — Recovery and readiness gate (1–2 days)**
* Recovery after partial failures (practice created, journey deleted mid-flight), seat/suspension changes,
  then `WORKSPACE_FEATURE_READINESS.prepare = true` + platform unhide + per-org entitlement — a separate,
  explicitly authorized release.

## Ships independently of Coach?

Yes. Prepare's org data plane and routes do not depend on Coach; Coach-in-org stays unavailable. Prepare must
not call Coach context builders for org journeys until Coach is org-ready (`prepareCoachingContext.ts`).

## How session review fits

Workspace session review (branch `feature/workspace-session-review`) covers Elevate/Replay/Interviews and **explicitly
excludes Prepare** at the database (see M3b). Journey-linked practices do **not** become reviewable when M1–M2 land;
they need M3b's migration, policies, UI and isolation tests. Readiness (`WORKSPACE_FEATURE_READINESS.prepare`) stays
`false` until M1–M4 (and M3b, if review of Prepare is required for launch) are validated end to end. Prepare remains
independent of Coach throughout.
