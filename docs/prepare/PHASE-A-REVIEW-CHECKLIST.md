# Prepare Phase A — diff review checklist

Use this **before merging**. Fail the PR if schema, ownership, flag wiring, or blast radius is wrong. UI polish is last.

---

## 0. Blast radius (must-fail)

```text
git diff --stat
```

Must **not** include:

- [ ] `apps/agent/**`
- [ ] Material `Elevate.tsx`
- [ ] Replay / Pulse scoring / `assistant.ts` / Bedrock
- [ ] PDF/DOCX parsers, multer CV pipeline, `UserCareerProfile`, `/api/career-profiles`
- [ ] Regex/heuristic “understand the first sentence” parser for company/role
- [ ] PrepSprint / PrepActivity models
- [ ] `Session.module = 'prepare'` or Session linkage columns
- [ ] New billing / Pro / Ultra gates

Allowed: nav/`App.tsx`, feature-flag types, admin Features, new `prepare` UI, Prepare routes, Prisma Prepare models, Vitest/Zod for Prepare only, `package.json` test deps.

---

## 1. Prisma (must-fail)

- [ ] `Preparation`: `userId`, `type`, `title`, `status`, timestamps; **no** company/JD on this table
- [ ] `InterviewPreparation` 1:1: company, role, optional JD, date, **`resumeText` + optional `resumeLabel` only** (no file columns, no profile FK)
- [ ] `PreparationStage`: type, name, sequence, status, optional schedule/complete, **one** optional interviewer (name, role, profileText)
- [ ] Comment or docs in PR: **one interviewer per stage in A; panels deferred**
- [ ] Stage status **only** `UPCOMING | SCHEDULED | COMPLETED | SKIPPED`
- [ ] Journey status `ACTIVE | PAUSED | OFFERED | COMPLETED | REJECTED | WITHDRAWN`
- [ ] Indexes: `(userId)`, `(userId, status)`, `(preparationId, sequence)`, `(preparationId, status)`
- [ ] User→Preparation onDelete matches Session (no special Cascade-on-User)
- [ ] Interview + stages cascade when Preparation is deleted
- [ ] Migration checked in; no required columns on existing Session/Replay/Pulse rows

---

## 2. Ownership / IDOR (must-fail)

- [ ] Auth + `requireFeature('prepare')` on all Prepare routes
- [ ] `userId` never from body/query for auth
- [ ] Get/patch/delete: `id` + `userId: req.user.userId`
- [ ] Stage ops via parent preparation ownership
- [ ] Reorder cannot include another preparation’s stage (test)
- [ ] Unowned → **404** consistently
- [ ] PATCH allowlist; no `data: req.body`

Tests: A cannot GET/PATCH/DELETE B; cannot mutate B’s stage; list own only; invalid enums; mass-assign `userId` ignored.

---

## 3. Feature flag (must-fail)

Duplicated types — incomplete updates look done.

- [ ] Server: `PlatformFeature`, `PLATFORM_FEATURES`, `DEFAULT_FLAGS`, map initializer include `prepare`
- [ ] Seed **`hidden: true`**
- [ ] `ensureFeatureFlags` inserts missing `prepare`
- [ ] Web context: type, defaults, **`setFlags` copies `prepare`**
- [ ] Nav + route gate + admin Features
- [ ] Flag off: no nav, `/prepare*` gated, APIs 403 `FEATURE_DISABLED`

---

## 4. Stage logic (must-fail if wrong)

- [ ] API returns `lastCompletedStage` and `nextStage` (not a conflated current)
- [ ] `nextStage`: earliest incomplete `SCHEDULED`, else first incomplete by sequence
- [ ] Jumping in at Technical marks **earlier default stages SKIPPED**, not `COMPLETED`
- [ ] No LLM for stage resolution

---

## 5. Product behavior

- [ ] Company + role required; JD, date, pasted resume, interviewer optional
- [ ] Title derived `Company — Role`
- [ ] Default stages; add / rename / remove / reorder persist
- [ ] Multiple concurrent ACTIVE journeys
- [ ] Delete cascades interview + stages only
- [ ] No fake practice / sprint / Advisor UI
- [ ] Landing is conversational **shell** (composer + labeled fields/chips), not ATS wizard and **not** a home-rolled NLP parser

---

## 6. Frontend

- [ ] `/prepare`, `/prepare/interviews`, `/prepare/interviews/:id`
- [ ] Round = chips; resume = textarea; interviewer paste, no URL fetch
- [ ] Cards show **Next** stage + date
- [ ] Mobile: chips wrap; stages scroll/stack
- [ ] No new component library

---

## 7. Commands

- [ ] Vitest Prepare-only; no `migrate reset` of dev DB
- [ ] prisma validate / generate
- [ ] server + web typecheck
- [ ] Prepare tests pass

---

## Sign-off

| Area | Pass? |
|------|-------|
| Blast radius | |
| Prisma | |
| IDOR | |
| Feature flag | |
| SKIPPED vs COMPLETED | |
| lastCompleted / nextStage | |

**After merge:** do not start B in the same Agent run.
