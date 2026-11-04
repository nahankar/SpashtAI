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

Deep-dive: [Northwind Elevate investigation](e13910bc-8058-4ade-bdc0-b517985064e8) (run `20261104-050729-3fe782`; agent log at `…/workflow-2026-11-04T05-07-25-789Z/agent-run.log`, not inside the run folder).

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Application stall after candidate-003 | **No app change yet** | N/A | **Verified:** turn 3 on app mic track (`mic-1.wav`, timeline); only **two** AWS Transcribe finals and **two** `Saved user message`; UI/API frozen at 2 learner turns; VAD `new turn` at 10:40:09.811 with **no** third `received user transcript` / LLM / coach TTS | Rerun on single-worker stack with agent STT logs; prove turn 3 save + coach reply **or** logged STT stall at boundary | **Blocked** — no evidence-backed smallest fix (Interview `RecognizerWatch` not proven for Elevate) |

**Not the cause:** voice-test `051039a` (coach-side long utterance recognition only).

### H. Prepare (and Coach) in organization workspaces

Assessment: [Prepare workspace assessment](9bd0ff81-ef0e-45c9-b2f5-cf9cd87dc364).

| Item | Branch / commits | Push / deploy | Validation | Still required | Recommendation |
|---|---|---|---|---|---|
| Org Prepare | `prepare: false`; platform `hidden: true`; no org shell routes | N/A | **Data plane on `main`:** `Preparation.workspaceId`, RLS, link triggers (`workspace-product-plane-database.test.ts`). **Missing:** `workspace-prepare-database.test.ts`, org nav/routes, `WORKSPACE_PRODUCTS` web gate, analytics attribution, journey delete `ReplayDeletion.workspaceId` | Smallest plan: HTTP tests + route guard parity → shell → analytics → **then** readiness/entitlements | **Deferred** — ~**8–15 dev-days** (not 3–5 weeks); Prepare can ship **without** Coach |

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

**Production main (`17f4bb3`) voice rerun:** **BLOCKED** for a dedicated isolated stack (no committed agent `.venv` under checked-out worktrees; `:7980` agent for `:4110` was stopped during reconciliation). **Walkthrough still usable:** `:5273`/`:4100`/`:7880` with tenancy agent (pid-managed, deps on host Python) — certifies **walkthrough code**, not EC2 `17f4bb3`. **Do not** conflate with production voice sign-off.

**Interview scenarios:** **BLOCKED** on fresh VTC accounts — `GET /api/interviews/options` → 403 until interview entitlements/grants are configured on the test database.

**Northwind org Elevate third-turn rerun:** not repeated this session; historical stall unchanged (§1.G). A new Personal Elevate run saved **three** learner turns (`session_1793782705850_ivcv045w5`) — different session, different stack, does **not** close the Northwind incident.

---

## 4. Prepare for workspace — separate assessment (no implementation)

See [Prepare workspace assessment](9bd0ff81-ef0e-45c9-b2f5-cf9cd87dc364). **Do not flip readiness alone** — UI, tests, analytics, platform visibility, and entitlements are not wired.

**Already on `main`:** org-scoped `Preparation` data + RLS (Checkpoint 7 “data only” per `docs/TENANCY-PRODUCT-PLANE.md`); Personal `/prepare/*` product unchanged.

**Smallest certified path (dependency order):**

1. `workspace-prepare-database.test.ts` (mirror `workspace-replay-database.test.ts`).
2. `requireWorkspaceProduct('prepare')` + access hardening; fix journey delete `ReplayDeletion.workspaceId`.
3. Org shell routes/nav; include `prepare` in web `WORKSPACE_PRODUCTS`.
4. Workspace analytics: separate Prepare from Interviews (journey Elevate practice uses `INTERVIEW` purpose today).
5. Only then: `WORKSPACE_FEATURE_READINESS.prepare = true`, platform unhide, entitlements.

**Effort:** ~**8–15 dev-days** (~1.5–3 engineer-weeks), high uncertainty on analytics semantics and deletion workers. **Prepare independent of Coach.**

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
