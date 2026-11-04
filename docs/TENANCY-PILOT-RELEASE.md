# Tenancy pilot release report

## Ready for bounded pilot release

Technical readiness for the KLSVDIT-bounded pilot (Elevate, Replay, Interviews, Feedback, Progress Pulse) is **yes**.

**Actual blockers:** none.

This report is the authorized release candidate. Merge, deploy, and KLSVDIT entitlements proceed from this SHA once the remaining operational gates below are recorded as passed.

Production Interviews use **Finish / Skip / Next**. `interview_conversation` stays hidden and disabled.

## Candidate

- **Branch:** `tenancy-pilot-rc`
- **SHA:** `c3fe621c0860d4df9c0f4151a6452148751c441b`
- **Excludes** Nova Sonic / agent greeting `95170b3`
- Editor checkout `feature/tenant-admin-demo-invitations` @ `81c393b` was not reset

Included organization products: Elevate, Replay, Interviews, Feedback, Progress Pulse.  
Unfinished in organizations: Prepare, Coach.

`WORKSPACE_FEATURE_READINESS` is now `true` for `elevate`, `replay`, `interviews`, `feedback`, and `progress_pulse`. Tenant settings cannot flip readiness. Organizations still see those products only after entitlements. This release entitles **KLSVDIT only**.

## Interview mode

`interview_conversation` remains `hidden` + `disabled` + `SELECTED_USERS`. Production Interviews will use **Finish / Skip / Next**. Conversation auto-advance was walkthrough-only.

## Gate results

| Gate | Result |
| --- | --- |
| Web `tsc -b` after `bindVoiceTakeover` (no `node:fs`) | **Pass** |
| Server suite sequential `--maxWorkers=1` on isolated `55443` | **747 passed / 124 skipped / 0 failed** |
| Isolated `verify-workspace-migration.mjs` through `20261103160000` on throwaway DB at `55443` | **Pass** — Personal ownership preserved; 42 tables enforce RLS; `platform_practice_totals` and both `workspace_job_scopes` signatures present |
| Fresh empty `prisma migrate deploy` | **Not a production signal** — historical `20250603120000_voice_config_providers` requires the existing baseline. Production upgrades from `d90bccf`. Shared `55441` was not modified |
| OpenAPI `@redocly/cli lint docs/api/workspaces.openapi.json` | **Valid** — 48 existing baseline warnings (46 `operation-operationId`, `info-license`, `no-server-example.com`) |
| Web lint | Branch-introduced: none. Baseline `origin/main` admin `react-refresh/only-export-components` errors remain. Replay `exhaustive-deps` warning exists on this branch |
| Interview-practice fixture `55441` | **Skipped** — schema behind; do not modify that database |

## Evidence (walkthrough)

- Human confirmation: Brightpath Elevate and Interviews both worked from the learner side.
- Saved Elevate: Northwind `session_1793728690320_rst8dgeyq` — COMMUNICATION, 135s, Pulse tracked, transcript present, recording completed. Isolation 404 from Brightpath and Personal.
- Brightpath Interview: `session_1793729971170_qgd1t7ela` / run `cmw10ifqk006p8pqmu91xmpxa` — saved conversation, turns, Q1 answer, recording. Isolation 404 from Northwind and Personal. Conversation and turns use the session-access guard.
- Q1 evaluation: `FAILED` `INVALID_OUTPUT_INCONSISTENT` — existing evaluator limitation.
- Prepare / Coach: unavailable in organizations (403).

## Enablement

Entitle only KLSVDIT: `elevate`, `replay`, `interviews`, `feedback`, `progress_pulse`.  
Do not entitle Prepare or Coach.  
Do not enable `interview_conversation`.  
Do not include `95170b3`.

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
- Production Interviews use Finish / Skip / Next; conversation remains off
- First Owner still requires a verified account
- Nova Sonic is excluded from this candidate
