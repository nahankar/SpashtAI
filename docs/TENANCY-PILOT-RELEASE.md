# Tenancy pilot release report

## Ready for bounded pilot release

Technical readiness for the KLSVDIT-bounded pilot (Elevate, Replay, Interviews, Feedback, Progress Pulse) is **yes**.

**Actual blockers:** none.

Deployment, merge, and production enablement are **not** authorized by this conclusion. Production `WORKSPACE_FEATURE_READINESS` stays all `false` except `pro` / `ultra` until a separate, explicit approval.

## Candidate

- **Branch:** `tenancy-pilot-rc`
- **SHA:** `a64eaa1` (this report). Checks ran on code parent `117455e` (404 guard and tests; no further code change)
- **Excludes** Nova Sonic / agent greeting `95170b3` (`git merge-base --is-ancestor` exit 1)
- **Does not include** working-branch HEAD `6278e90` / `6e8c881` (those still contain `95170b3`)
- Production revision: `origin/main` `d90bccf`
- Editor checkout `feature/tenant-admin-demo-invitations` @ `81c393b` was not reset

Included organization products: Elevate, Replay, Interviews, Feedback, Progress Pulse.  
Unfinished in organizations: Prepare, Coach.

Local walkthrough only: `WORKSPACE_READY_OVERRIDE=replay,elevate,interviews,feedback` (ignored in production).

## Interview mode (walkthrough vs production)

`interview_conversation` is a Super Admin platform flag. Product default remains `hidden` + `disabled` + `SELECTED_USERS`. It was unhidden only in `spasht_walkthrough`. The RC does not turn it on.

| Mode | How it is selected | Production pilot | Human-tested? |
| --- | --- | --- | --- |
| **Manual** (Finish / Skip / Next) | Flag hidden or disabled | **This is the production path** after Interviews readiness + entitlement, unless Super Admin later enables the flag | Yes — Brightpath runs before the walkthrough flag flip; the learner pressed Next |
| **Conversation** (5 s silence auto-advance) | Flag unhidden and enabled. In an organization, that is enough (no per-user grant) | Not the production default. Walkthrough-only unless Super Admin enables it in production | Yes — `session_1793729971170_qgd1t7ela` |

Isolation, save, recording, and grading are the same in both modes. The confirmed “Interviews worked” run was conversation. Production will use the earlier **manual** path. That path was exercised; it is not a missing check.

Turning conversation on in production is a Super Admin flag change, not a `WORKSPACE_FEATURE_READINESS` flip. Do not treat the walkthrough DB row as shipped.

## Evidence

- **Human confirmation:** Brightpath Elevate and Interviews both worked from the learner side.
- **Saved Elevate evidence:** Northwind `session_1793728690320_rst8dgeyq` — COMMUNICATION, 135s, Pulse `tracked`, transcript present, recording completed (2,138,785 bytes). Direct-ID and media isolation: Brightpath and Personal return 404 on session, conversation, turns, transcript, ticket, and stream.
- **Brightpath Elevate:** no saved COMMUNICATION artifact located. Brightpath `GET /sessions` is empty; every Brightpath row for this learner is INTERVIEW. Verification gap, not a product defect. No second microphone run.
- **Brightpath Interview:** `session_1793729971170_qgd1t7ela` / run `cmw10ifqk006p8pqmu91xmpxa` — 8 conversation messages, 8 turns, Q1 answer (361 characters) saved, recording `cmw10l1oo007x8pqmllsldprk` completed (998,161 bytes). Northwind and Personal: session, conversation, turns, transcript, ticket, stream, run, and assessments are 404.
- **Q1 evaluation:** `FAILED` `INVALID_OUTPUT_INCONSISTENT`, 1 attempt, `completedAt` set, `retryable: false`. Answer and recording preserved. UI: “Technical feedback · Evaluation service unavailable.” Prompt and model were not changed. Existing evaluator limitation, not a tenancy regression.
- **Prepare / Coach:** unavailable in organizations (403). Delivery alignment still `pending`.

## Checks on `117455e`

| Check | Result |
| --- | --- |
| Restricted-role workspace suites, serial (`maxWorkers=1`) on `127.0.0.1:55443` | **76 passed / 8 files** (elevate including conversation/turns 404, replay, interviews, isolation stress, session, product plane, invitations, admin analytics) |
| `verify-workspace-migration.mjs` | **Pass** — Personal ownership preserved; 42 tables enforce RLS |
| Server `tsc -b` | **Pass** |
| Web Vite production build | **Pass** |
| Agent `unittest discover test_*.py` (RC tree, existing venv) | **262 passed** |
| Web vitest `src/workspaces`, `src/features/live-session`, Interview playback feedback | **126 passed / 20 files** |
| `npm --workspace apps/web run typecheck` (`tsc -b`) | **Failed** — `voiceTakeover.test.ts` imports `node:fs`; `tsconfig.app.json` has no Node types. Test-only; production build does not include that file |
| Full parallel `npm --workspace apps/server test` with `WORKSPACE_TEST_DATABASE_URL` | **Failed / not a clean signal** — `too many clients already`, invitation `socket hang up` (known parallel flake). Isolated: `admin-analytics*.test.ts` **2 failed** because overview now calls `loadPlatformPracticeTotals` and those mocks omit `$transaction`. Pre-existing mock gap, not introduced by the 404 commit. Covered in workspace admin analytics DB tests |
| Interview-practice fixture `55441/simple_bank` | **Skipped** — schema behind (`Session.workspaceId` missing) |
| OpenAPI / web lint | **Skipped** — not in the documented reproduce list for this pass |
| Merge, deploy, readiness flip | **Not run** |

`95170b3` is not an ancestor of this candidate. Working-tree Nova Sonic agent files were not exercised.

## Review findings A–E

| ID | Resolution |
| --- | --- |
| A | Read-only admin paths do not `FOR UPDATE` the Workspace row. Mutations use `scopedWrite`. |
| B | Interpret binds in a short transaction, calls the model outside, revalidates before return. |
| C | Platform overview practice totals are explicit `platform_practice_totals` aggregates with optional `?workspaceId=`. RLS stays on. |
| D | Recent leftovers return `409 VOICE_SESSION_ACTIVE`. Cancel / Take over; leftover `audioStatus` stays pending; first-close duration is immutable. |
| E | Due-only, ordered, keyset-paged discovery (50). Learner assessment sweep pages every due learner. |

## Tenant onboarding

Configuration only: name, slug, branding, timezone, limits; verified Owner (`OWNER_ACCOUNT_REQUIRED`); entitlements; enrollment/invitation copy; user invitations. No per-tenant code or migration.

## Pending production migrations

From `d90bccf`, apply **all** of these once as the migration/owner role (not the runtime role):

1. `20261103090000_workspace_product_plane`
2. `20261103120000_pilot_review_fixes`
3. `20261103150000_workspace_job_scopes_compat`
4. `20261103160000_workspace_job_scopes_unambiguous`

Foundation through enrollment (`20261101120000` … `20261102190000`) is already on `origin/main`.

## Proposed enablement (not authorized)

Do not run these until a separate approval. This report does not enable production.

**Deploy (readiness still off)**

1. Backup. Drain live Elevate/Interview rooms if the product-plane migration is pending.
2. `prisma migrate deploy` once with owner credentials.
3. Deploy this candidate SHA.
4. Runtime role `NOSUPERUSER` / `NOBYPASSRLS`. `/ready` must succeed.
5. Admin-shell smoke: create org, assign verified Owner, invitations, users, feature settings. Learners see no organization products.

**Product enablement (second approval)**

6. Flip `WORKSPACE_FEATURE_READINESS` in product code for `elevate`, `replay`, `interviews`, `feedback` only. Tenant settings cannot do this.
7. Entitle those products (and Pulse) on KLSVDIT.
8. Confirm platform flags `interviews`, `interview_voice`, and `interview_adaptive` match the existing Personal Interviews pilot. Leave `interview_conversation` hidden/disabled unless Super Admin explicitly wants auto-advance.
9. Product smoke: Personal Elevate still works; org nav shows only ready entitled products; cross-workspace session id / recording / subscription fail closed.

**Do not** enable Prepare or Coach. **Do not** include `95170b3`.

## Rollback

1. Redeploy the previous application revision first (it must not call `platform_practice_totals` or the 4-arg worker pagination).
2. Keep the 1-arg `workspace_job_scopes(text)` wrapper.
3. Do not drop the 4-arg form or `platform_practice_totals` while this candidate (or later) is running.
4. After organization activity exists, do **not** roll back `20261103090000_workspace_product_plane`.

## Limitations (not blockers)

- Prepare and Coach stay unfinished in organizations
- Delivery alignment / Gentle completion is an independent worker path
- Brightpath Elevate has human confirmation only; no saved COMMUNICATION artifact
- Q1 technical feedback unavailable (`INVALID_OUTPUT_INCONSISTENT`); answer and recording kept
- Session recording has no per-answer `audioStart`
- `interview_conversation` remains walkthrough-only unless Super Admin enables it
- First Owner still requires a verified account
- Nova Sonic is excluded from this candidate
