# Prepare Phase A — PRD

**Status:** Ready to implement  
**Scope:** Journey persistence + conversational **shell** (progressive fields/chips) + stages + flag + IDOR tests  
**Out of scope:** Intake LLM, regex NL parser, PDF/DOCX extract, `UserCareerProfile`, Gap Engine, Prep Sprint generator/tables, Pulse/Elevate reads, questions, Advisor, agent, RAG, LinkedIn fetch, multi-interviewer CRM

---

## Why this exists (vs baseline)

Today: Elevate = skill practice, Replay = past recording, Pulse = skill trends.  
Missing: durable **Google vs Microsoft vs Amazon** journeys with a next round.

`Session.focusContext` is a coaching hint, not an interview lifecycle.

**A thesis:** conversation-shaped create that **persists** company, role, stage, optional JD / pasted profile / one interviewer — without becoming a document-processing or NLU project.

**A does not validate the full Prepare thesis.** It validates: people will create and return to Interview Journeys. Gap + Sprint come in D1/D2.

---

## What we add vs baseline

| Addition | Why |
|----------|-----|
| `Preparation` | Generic “why I’m preparing.” Future Pitch/Viva without `companyName`. |
| `InterviewPreparation` 1:1 | `companyName`, `roleTitle`, optional `jobDescriptionText`, `interviewDate`, optional **`resumeText` + `resumeLabel`**. |
| `PreparationStage` | Editable pipeline. Real loops differ. |
| Flag `prepare` | Seed **hidden**. Same `hidden`/`disabled` as Elevate/Replay. |
| `/prepare` conversational shell | Not nested under Elevate. Not an ATS wizard. |
| One optional interviewer **per stage** | Name, role, pasted professional text. Panels deferred (see VISION). |
| Zod + Vitest for Prepare only | No repo-wide test platform. |

### Explicitly not in A

| Item | Why wait |
|------|----------|
| `UserCareerProfile` / PDF extract / multer CV pipeline | Does not validate journeys; huge blast radius. **Phase F.** |
| Regex/heuristic company-role parser | Disposable when Intake Agent (E) exists. |
| Marking earlier stages `COMPLETED` because user is at Technical | Invents interview history. Use `SKIPPED`. |
| PrepSprint / PrepActivity tables | Designed in VISION; **built in D2**. |
| Bedrock, Pulse reads, Elevate.tsx, agent | Later phases. |

---

## Product model

```text
Preparation
  type INTERVIEW, title, status, userId, timestamps, completedAt?

InterviewPreparation  (1:1)
  companyName, roleTitle
  jobDescriptionText?
  interviewDate?
  resumeText?      // paste only
  resumeLabel?     // optional, e.g. "EM 2026"

PreparationStage
  type, name, sequence, status
  scheduledAt?, completedAt?
  interviewerName?, interviewerRole?, interviewerProfileText?
  // Phase A: at most ONE interviewer per stage. Panels = later join table.
```

**Journey status:** `ACTIVE` · `PAUSED` · `OFFERED` · `COMPLETED` · `REJECTED` · `WITHDRAWN`  
**Stage status:** `UPCOMING` · `SCHEDULED` · `COMPLETED` · `SKIPPED`  
Outcome pass/fail is Phase B reflection, not stage status.

**Title:** `{companyName} — {roleTitle}`.

### Where they are in the loop

User picks e.g. Technical:

- That stage: `UPCOMING`, or `SCHEDULED` if a date was given  
- **Earlier** default stages: `SKIPPED` (not `COMPLETED`)  
- Later stages: `UPCOMING`

### Server-derived (not LLM)

```text
lastCompletedStage   // last COMPLETED by sequence, else null
nextStage            // earliest incomplete SCHEDULED, else first incomplete (UPCOMING|SCHEDULED) by sequence
```

List/detail API returns these. UI: **Next: {name} — {date?}**. Do not invent a third “current” that conflates last done and next up.

**Default pipeline (editable):** Applied → Recruiter → Technical → Hiring Manager → Leadership → HR → Offer.

---

## UX

Landing: **What are you preparing for?** plus a composer. Coming-later visuals only (Presentation, Pitch, …). Optional “Enter details instead.”

**Progressive fields / chips — not NLU:**

1. Company * and Role * (required). Date optional.  
2. Round chips: Recruiter · Technical · Hiring Manager · Leadership · HR · Not sure.  
3. Optional JD textarea.  
4. Optional **Profile / resume for this role** — paste textarea + optional label. Copy: we use it only to personalise preparation.  
5. Optional interviewer: name, title, paste public professional text. Never fetch URLs.  
6. Create journey; land on detail.

The first box may be free text for the user to dump thoughts, but **do not** regex-parse it into company/role. They fill or confirm labeled fields.

List: Active / Completed. Cards: company, role, **Next** stage + date, ticks. No fake sprint/practice counts.

Detail: Overview + Stages. Edit; move stages up/down. Show pasted profile label/snippet and one interviewer if set. **No** Sprint / Practice Now / Advisor / gap priorities.

Mobile: chips wrap; stages scroll or stack. Existing Card/Dialog/Tabs/Toast/Input/Textarea/Button. **No new Select library.**

Language: Your Interviews / Next Round — not pipeline entity.

---

## API

Auth + `requireFeature('prepare')`.

```text
GET/POST           /api/preparations
GET/PATCH/DELETE   /api/preparations/:id
POST               /api/preparations/:id/stages
PATCH/DELETE       /api/preparations/:id/stages/:stageId
POST               /api/preparations/:id/stages/reorder
```

No `/api/career-profiles` in A.

Detail includes interview fields, stages, `lastCompletedStage`, `nextStage`.

Ownership: `userId` from `req.user` only. Nested stage via parent preparation. Unowned → **404**. PATCH allowlist (never `userId`, `id`, `type`). No `prisma.update({ data: req.body })`.

Delete: hard-delete Preparation cascades interview + stages. No soft-delete.

---

## Feature flag

Update **both** server and web `PlatformFeature` maps (`setFlags` must copy `prepare`). Seed **`hidden: true`**. Admin Features UI. `events.ts` if needed.

---

## Tests

Smallest Vitest + supertest. **Do not** `migrate reset` the dev `spashtai` DB.

Create/list/get own; A cannot get/patch/delete B; stage CRUD + reorder isolation; invalid enums; mass-assign `userId` ignored; **selecting Technical marks earlier stages SKIPPED not COMPLETED**.

---

## Acceptance

- Flag hidden by default; nav/routes/APIs honor it  
- Multiple concurrent journeys  
- Conversational shell; company + role required; JD, date, pasted resume, one interviewer optional  
- **No** PDF extract, **no** profile library, **no** NL parser  
- Default stages; earlier = SKIPPED when jumping in; next/lastCompleted from server  
- Stages editable / reorderable  
- IDOR tests pass  
- Agent, Elevate, Replay, Pulse **untouched**

**Stop after A.**

Hard to unwind: Prisma graph + nested ownership. Easy later: card spacing.
