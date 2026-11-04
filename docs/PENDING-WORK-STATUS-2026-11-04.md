# Pending work status — 4 November 2026

Verified at reconciliation time (do not treat older chat summaries as source of truth).

| Surface | Revision |
|---|---|
| GitHub `origin/main` | `17f4bb3717fecbc1f5049ddb8d20dabb6312b755` |
| EC2 `/opt/spashtai` | `17f4bb3717fecbc1f5049ddb8d20dabb6312b755` (LiveKit yaml overlays locally modified only) |
| Production health | `/health` ok, `/ready` ready |

---

## 1. Pending-work inventory

### A. Workspace admin nav + invitation email + signup profile (shipped)

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Side nav, invitation body, profile-before-Google | `17f4bb3` on `main` | Pushed; deployed API+web together | Prior vitest + production UI checks | None for this slice | **Ready (live)** |

**Note:** `tenancy-pilot-rc` still has 25 uncommitted files mirroring this UX work; they are **not** additional product diffs vs `main`. Prefer `main` / `spashtai-ux-invites-from-main` as source of truth.

### B. Invitation signup location resolution (server hotfix)

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| `attachSignupLocation`, merge rules, acceptance + Google auth | `561f1ea` on `hotfix/invitation-signup-location` | Pushed; **not** merged to `main` | `profile-location.test.ts` (3), `workspace-enrollment` (4), server+web `tsc -b`, root `npm run build` | Invitation DB suites (`invitations-database`) need `WORKSPACE_TEST_DATABASE_URL`; browser signup matrix on staging | **Ready to review** (separate release from voice/session) |

### C. Log redaction + org refresh auth (shipped)

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Pino redaction + identity-only `/api/auth/me` refresh | `de68bc1`, `bc43b34` on `main` | Deployed (superseded by `17f4bb3`) | Prior prod verify | None | **Ready (live)** |

### D. Session lifecycle + LiveKit release failure handling

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Server-time takeover/close, retain occupancy on LiveKit delete failure | `5351b92` on `tenancy-pilot-rc` (not on `main`) | Not on `main`/EC2 | Isolated `5283`/`4110` @ `5351b92`: API lifecycle + Chromium takeover (see `docs/RELEASE-VALIDATION-5351b92.md`) | Multi-turn Elevate natural completion; do not bundle with signup hotfix | **Deferred** — separate release after Elevate voice gate |

### E. Delivery-alignment lease initialization

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Upsert lease when missing; concurrent worker fix | `855cfba`, `c0ec02a` on `tenancy-pilot-rc` | Not on `main`/EC2 | Isolated DB seed + worker sweep on `5351b92` stack | Prod/walkthrough DBs without `DeliveryAlignmentLease` row still stall alignment (`attempts=0`) | **Deferred** — ship with or immediately after session-lifecycle candidate; not with signup UX |

**Dependency:** Elevate voice runs report `deliveryAlignmentStatus=pending` until lease + worker path is fixed (see §7).

### F. Voice test candidate tool (developer-only; not deployed)

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Standard workflow / guidance | `7b57aaf` on `codex/voice-test-candidate` | Tool branch on GitHub; **not** in app build | Documented in `tools/voice-test-candidate/README.md`, `docs/VOICE-TEST-WORKFLOW-VALIDATION.md` | Use ≥ `051039a` for long utterances | **Ready for local/CI use** |
| Long-utterance recognition windows | `051039a` | Same | Unit tests in tool + live scenarios per `def1be3` docs | None for tool itself | **Ready** |
| Findings handoff doc | `def1be3` | Same | References evidence paths under `tools/voice-test-candidate/runs/` | — | **Ready** |

**Do not** run from `spashtai-voice-workflow` @ `7b57aaf` alone — it lacks `051039a`. Use `/Users/neelesh.ahankari/Applications/SpashtAI` @ `def1be3` (contains `051039a`).

### G. Northwind third learner turn (`session_1793768850376_v90vec3ax`)

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Application stall after candidate-003 | N/A (investigation) | N/A | Walkthrough run `workflow-2026-11-04T05-07-25-789Z` / `20261104-050729-3fe782` — see `docs/RELEASE-VALIDATION-5351b92.md` §3 | Publication → VAD → recognizer → persist boundaries still unverified; **not** fixed by `051039a` | **Blocked** — evidence-supported app/agent fix only |

### H. Prepare (and Coach) in organization workspaces

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Org Prepare | `WORKSPACE_FEATURE_READINESS.prepare = false` on `main` | N/A | Code inspection only (§6) | Full workspace product plan before enable | **Deferred** — assessment only |

---

## 2. Signup / invitation behavior

**Google authentication remains required** for invitation acceptance and personal signup. Preview UI omits Google by design; that is not email-only login.

| Check | Status |
|---|---|
| Workspace enrollment fields + regular profile before new account | **Enforced in code** (`PROFILE_REQUIRED`, step UI); deployed on `17f4bb3` |
| Google email must match invitation | **Enforced** (`wrong_account` 403) |
| Expired / revoked / wrong account / repeat accept | **Covered** in `invitationAcceptance.ts` + DB tests when DB available |
| Existing profile / permissions / Personal history | **Existing-user path** in `resolveGoogleAccount`; invitation tests assert no role creep |
| Personal Google sign-in without profile fields | **Allowed** for complete profiles; incomplete Google users still need fields |
| Empty custom invitation message | **Accept + expiry footer only** (`buildInvitationEmail`) |
| Pincode → city/state/country on invite accept | **Fixed on `561f1ea`** (not yet on `main`) |

---

## 3. Voice tool run (this reconciliation)

| Field | Value |
|---|---|
| Tool | `0.1.0` @ **`def1be3`** (includes **`051039a`** long-utterance fix) |
| Workflow | `npm run test:voice` from `Applications/SpashtAI/tools/voice-test-candidate` |
| Target | `http://localhost:5273` → API `http://localhost:4100`, LiveKit `ws://localhost:7880` |
| Workspace | Personal (Elevate) |
| Application (running processes) | **`855cfba`** tenancy walkthrough — **not** production `17f4bb3` |
| Scenario | `elevate-learner` |
| Outcome | **INCONCLUSIVE** — live audio, 5 candidate turns, transcript/recording checks **passed**; `deliveryAlignmentStatus` still **pending** after 120s |
| Evidence | `tools/voice-test-candidate/runs/workflow-2026-11-04T08-58-21-695Z/20261104-085824-8821b4/` |

**Production main (`17f4bb3`) voice rerun:** **BLOCKED** today — no stable isolated stack at that SHA (isolated agent venv missing under UX worktree; `:4130` API did not stay up). `:4110`/`:7980` agent was not running after earlier stop. **Do not** treat walkthrough `855cfba` Elevate as certifying production `17f4bb3` voice behavior.

**Interview scenarios:** **BLOCKED** on fresh VTC accounts — `GET /api/interviews/options` → 403 until interview entitlements/grants are configured on the test database.

**Northwind org Elevate third-turn rerun:** not repeated this session; historical stall unchanged (§1.G). A new Personal Elevate run saved **three** learner turns (`session_1793782705850_ivcv045w5`) — different session, different stack, does **not** close the Northwind incident.

---

## 4. Prepare for workspace — separate assessment (no implementation)

**Current state on `main`:** `prepare` and `coach` are explicitly **not** workspace-ready (`WORKSPACE_FEATURE_READINESS`). Organization shell nav (`apps/web/src/workspaces/shell/model.ts`) has no Prepare route; platform Personal still uses `/prepare/*`.

**Reusable without org enablement:** Prisma `Preparation` / journey models already carry `workspaceId`; Personal Prepare UI and APIs exist under `/prepare`.

**Likely work for org Prepare (smallest credible slice):**

1. **Readiness & gating** — set `prepare: true` only after scoped API routes, RLS, feature flags, and admin toggles are verified (not a flag flip alone).
2. **HTTP + RLS** — workspace-scoped list/create/update for preparations, stages, reflections; audit rows; deny cross-tenant reads (mirror Elevate/Replay patterns).
3. **Web** — org nav entry, `FeatureGate`, deep links from Replay/Elevate that today assume Personal `/prepare/...` paths.
4. **Media & jobs** — event recordings, reprocess/export/delete under workspace storage paths and retention rules.
5. **Analytics** — attribute Prepare usage in workspace admin reports separately from Personal.
6. **Limits** — seat/daily evaluation/concurrent voice caps where Prepare triggers voice or AI jobs.

**Coach:** shares home/threads model with Personal; org Coach remains `ready: false` — likely **after** Prepare or a parallel track; do not bundle with Prepare v1.

**Effort (order-of-magnitude, high uncertainty):**

| Slice | Assumption | Estimate |
|---|---|---|
| Prepare org MVP (journeys + history + nav + permissions, no new AI surfaces) | Elevate/Replay workspace patterns reused; no new migration beyond existing schema | **3–5 engineer-weeks** |
| + Recordings/exports/deletion parity | Same storage stack as Replay | **+1–2 weeks** |
| + Analytics attribution | Uses existing admin analytics plumbing | **+1 week** |
| Coach org | Separate messaging/home integration | **Not estimated here**; likely **≥ Prepare** |

Prepare could ship **independently of Coach** if scope is limited to journey CRUD + org-scoped history and links; it **should not** ship independently of workspace RLS/API scoping work.

---

## 5. Recommended release order (no merge/deploy authorized here)

1. **`561f1ea`** — invitation location hotfix only (after DB invitation tests if available).
2. **`5351b92` + `855cfba`/`c0ec02a`** — session lifecycle + delivery alignment (together or back-to-back; own voice gate).
3. **Northwind stall** — fix only with trace-backed app/agent change; re-run org Elevate on walkthrough with owner auth + updated tool.
4. **Prepare** — plan only until acceptance criteria above are agreed.

---

## 6. Developer vs application artifacts

| Changes | Deploy with API/web? |
|---|---|
| `apps/*`, `infra/ec2/deploy.sh` targets | **Yes** |
| `tools/voice-test-candidate/*`, workflow docs | **No** — local/CI only |
| `docs/PENDING-WORK-STATUS-*.md`, `RELEASE-VALIDATION-*.md` | **No** |
