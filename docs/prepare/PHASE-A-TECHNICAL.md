# Prepare Phase A — technical implementation plan

Product rules: [PHASE-A.md](./PHASE-A.md). Merge bar: [PHASE-A-REVIEW-CHECKLIST.md](./PHASE-A-REVIEW-CHECKLIST.md).

**Do not change:** `apps/agent/**`, `Elevate.tsx` (except nav if needed — prefer `App.tsx` only), Replay, Pulse scoring, Bedrock, `assistant.ts`.

**Zod is already** in `apps/server/package.json`. Use it on Prepare routes only; do not migrate existing routes.

---

## 1. Database

**File:** `apps/server/prisma/schema.prisma`

On `User`, add:

```text
preparations Preparation[]
```

Add enums + models (adapt `cuid()` / `@updatedAt` to match `Session`):

```text
enum PreparationType { INTERVIEW }
enum PreparationStatus { ACTIVE PAUSED OFFERED COMPLETED REJECTED WITHDRAWN }
enum PreparationStageType {
  APPLIED RECRUITER TECHNICAL BEHAVIORAL HIRING_MANAGER
  CASE_ASSIGNMENT LEADERSHIP HR OFFER CUSTOM
}
enum PreparationStageStatus { UPCOMING SCHEDULED COMPLETED SKIPPED }

model Preparation {
  id, userId → User (onDelete: same as Session — no extra Cascade-on-User)
  type, title, status, completedAt?
  createdAt, updatedAt
  interview InterviewPreparation?
  stages    PreparationStage[]
  @@index([userId])
  @@index([userId, status])
}

model InterviewPreparation {
  id, preparationId @unique → Preparation onDelete Cascade
  companyName, roleTitle
  jobDescriptionText String? @db.Text
  interviewDate DateTime?
  resumeText String? @db.Text
  resumeLabel String?
  createdAt, updatedAt
}

model PreparationStage {
  id, preparationId → Preparation onDelete Cascade
  type, name, sequence Int
  status
  scheduledAt?, completedAt?
  interviewerName?, interviewerRole?, interviewerProfileText String? @db.Text
  createdAt, updatedAt
  @@index([preparationId, sequence])
  @@index([preparationId, status])
}
```

**Migration:** `apps/server/prisma/migrations/<timestamp>_prepare_phase_a/migration.sql` via `npx prisma migrate dev` — do not hand-edit prod.

**Do not add:** `UserCareerProfile`, Session FKs, PrepSprint tables.

---

## 2. Server — new files

| File | Responsibility |
|------|----------------|
| `apps/server/src/lib/prepareStages.ts` | Default pipeline list; `applyWhereYouAre(stages, currentType)` → earlier **SKIPPED**, current UPCOMING/SCHEDULED, later UPCOMING. `lastCompletedStage` / `nextStage` from a stage array. |
| `apps/server/src/lib/prepareSchemas.ts` | Zod: create body, patch preparation, patch stage, reorder `{ stageIds: string[] }`. Max lengths for JD/resume/profile text. |
| `apps/server/src/lib/prepareAccess.ts` | `getOwnedPreparation(userId, id)` → 404-shaped miss. Never take `userId` from client. |
| `apps/server/src/routes/preparations.ts` | Express router. |
| `apps/server/src/services/preparations/createInterviewJourney.ts` | Transaction: Preparation + InterviewPreparation + stages. Title = `{company} — {role}`. |

**Default stage names (sequence 0…):** Applied, Recruiter, Technical, Hiring Manager, Leadership, HR, Offer.

**Create body (conceptual):** `companyName`, `roleTitle`, optional `jobDescriptionText`, `interviewDate`, `resumeText`, `resumeLabel`, `currentStageType` (enum or `UNSURE` → all UPCOMING).

**PATCH Preparation:** allowlist `status`, `title` (or re-derive from interview patch). Interview fields: company, role, JD, date, resumeText, resumeLabel. Never `userId`, `type`, `id`.

**PATCH stage:** name, type, status, dates, interviewer fields. Reorder: load all stage IDs for **this** preparation; if payload ID missing or extra → 400; write new `sequence`.

**GET list:** `where: { userId }`, include interview + stages, attach `lastCompletedStage` + `nextStage` per row. Sort: next interview date, then updatedAt.

**GET by id:** same include; 404 if not owner.

**DELETE:** `delete` preparation (cascade children).

**Logs:** `prepare.created` with `preparationId` only — never JD/resume/interviewer profile text (`reqLog`).

---

## 3. Server — existing files to edit

| File | Change |
|------|--------|
| `apps/server/src/index.ts` | `app.use('/api/preparations', requireAuth, requireFeature('prepare'), preparationsRouter)` |
| `apps/server/src/lib/featureFlags.ts` | `'prepare'` on `PlatformFeature`, `PLATFORM_FEATURES`, `DEFAULT_FLAGS` (**hidden: true**), and the default object inside `getFeatureFlagsMap()` |
| `apps/server/src/routes/events.ts` | `ALLOWED_FEATURES` add `'prepare'` |
| `apps/server/src/lib/jwt.ts` | No change (`req.user.userId` already) |

Admin flags UI lists whatever is in DB; `ensureFeatureFlags()` will insert `prepare` if `DEFAULT_FLAGS` includes it. Confirm `PLATFORM_FEATURES.includes` in `admin/feature-flags.ts` — already uses that array.

**404 helper:** `{ error: 'Not found' }` — same for missing and unowned.

---

## 4. Tests (new)

Zod is present; **Vitest + supertest are not**. Add to `apps/server`:

- devDeps: `vitest`, `supertest`, `@types/supertest`
- script: `"test": "vitest run"`
- `apps/server/vitest.config.ts`
- `apps/server/src/routes/preparations.test.ts` (or `apps/server/src/prepare/*.test.ts`)

**DB:** `DATABASE_URL` for tests must not `migrate reset` the developer `spashtai` DB. Prefer a second database `spashtai_test` or transactional cleanup of rows created in the test.

**Auth:** reuse how other routes verify JWT — mint tokens with existing `sign` helper if tests can import it; otherwise extract a tiny `signTestToken(userId)` using the same JWT secret from `.env`.

Must cover: create; list isolation; get/patch/delete IDOR; stage reorder IDOR; Technical jump → earlier **SKIPPED**; invalid enum 400; extra `userId` in body ignored.

---

## 5. Web — feature flag (duplicated types)

| File | Change |
|------|--------|
| `apps/web/src/contexts/FeatureFlagsContext.tsx` | Type `'prepare'`; `DEFAULT_FLAGS`; **`setFlags({ elevate, replay, prepare })`** |
| `apps/web/src/components/auth/FeatureGate.tsx` | `FEATURE_LABELS.prepare = 'Prepare'` |
| `apps/web/src/App.tsx` | `NavFeatureLink` union includes `'prepare'`; desktop + mobile nav **Prepare** (with Replay / Elevate); routes below |
| `apps/web/src/pages/Home.tsx` | Optional third `FeatureModuleCard` when `isVisible('prepare')` |
| `apps/web/src/pages/admin/FeatureFlags.tsx` | Should work if API returns the new row; check labels aren’t hardcoded to two features |
| `apps/web/src/pages/admin/FeatureAnalytics.tsx` | Optional: don’t break if `enabledFeatures` includes prepare (defaults are elevate/replay only today) |

---

## 6. Web — new UI

| File | What |
|------|------|
| `apps/web/src/lib/prepare-types.ts` | Shared TS types / stage enums matching Prisma |
| `apps/web/src/lib/prepare-api.ts` | Fetch wrappers using `getAuthHeaders()` / `apiClient` |
| `apps/web/src/pages/Prepare.tsx` | Landing: “What are you preparing for?” composer + **labeled** Company / Role fields + chips + optional JD/resume/interviewer. **No regex parse of the composer.** Submit → POST → navigate to detail |
| `apps/web/src/pages/InterviewJourneys.tsx` | List Active / Completed; cards with **Next** |
| `apps/web/src/pages/InterviewJourney.tsx` | Overview + Stages; edit; move up/down; patch |
| `apps/web/src/components/prepare/*` | Small pieces: `StageTracker`, `CreateJourneyFields`, `StageEditor` — avoid a 1500-line page |

**Routes in `App.tsx`** (inside `ProtectedRoute`, wrapped in `FeatureGate feature="prepare"`):

```text
/prepare
/prepare/interviews
/prepare/interviews/:id
```

Breadcrumbs in `AppBreadcrumbs` if that map is path-based — add Prepare titles.

**Do not** add shadcn Select. Round = button chips. Forms = Input, Textarea, Button, Dialog, Tabs, Card, toast (`sonner`).

---

## 7. Logic to implement once (server is source of truth)

**Where you are:** `currentStageType = TECHNICAL` → stages before Technical `SKIPPED`; Technical `SCHEDULED` if `interviewDate` else `UPCOMING`; rest `UPCOMING`.

**nextStage:** first stage with `status === SCHEDULED` and not complete, by sequence; else first `UPCOMING`/`SCHEDULED` by sequence.

**lastCompletedStage:** last `COMPLETED` by sequence, else null.

Do not compute this only in React.

---

## 8. Suggested order of work

1. Prisma migrate + generate  
2. `prepareStages` + Zod + access helper + routes + wire `index.ts`  
3. Feature flag both stacks  
4. Vitest IDOR + SKIPPED test  
5. API client + pages + nav + FeatureGate  
6. `prisma validate`, `apps/server` `tsc`, `apps/web` `typecheck`, `vitest run`

---

## 9. Explicit non-goals (fail the PR if present)

- PDF/DOCX/multer CV library  
- NLP/regex company parser  
- Marking earlier stages `COMPLETED` on jump-in  
- PrepSprint models  
- Session.mode / preparationId  
- Agent / Elevate practice launch
