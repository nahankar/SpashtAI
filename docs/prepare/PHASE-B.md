# Prepare Phase B — PRD

**Status:** Draft for after Phase A merge  
**Depends on:** Phase A journeys + stages + flag + ownership APIs  
**Do not implement until A is reviewed.** Bind this prompt to **actual** A file/route names.

---

## Why B exists (vs baseline and vs A)

**Current SpashtAI baseline** still has no interview memory. Elevate/Replay store **practice and recordings**, not “what they asked on Sep 7.”

**Phase A** makes Prepare a **conversation-shaped create** plus durable journey memory (company, role, stages, optional JD/interviewer). That is still not the full product.

**Phase B thesis:** After a real round, log it in under two minutes. That feeds the later loop: *real interview → memory → next sprint* ([VISION.md](./VISION.md)). Without B, a conversational tracker still forgets what they asked.

Replay = optional richer evidence. **Log Interview = universal** (many rounds cannot be recorded).

NORTHSTAR Layer 7 stays **out**. B stores **structured rows**, not embeddings. B still does **not** generate a Prep Sprint or read Pulse.

---

## What we add vs Phase A / baseline (and why)

### New in B

| Addition | Why |
|----------|-----|
| **Log Interview** (primary flow) | Real interviews often **cannot** be recorded. Replay is optional. Prepare must work without audio. |
| `InterviewQuestion` | One line = one question. Memory across Recruiter → Technical → HM. Later “practice this question” (C) needs rows, not a blob in notes. |
| `StageReflection` | Feeling + went well / hard / **what surprised you** / clues / next hints. Outcome (`PASSED` / `REJECTED` / `PENDING` / `UNKNOWN`) lives **here**, not as a second stage status. |
| Activity **timeline** on the journey | Generated from stages + questions + reflections (no event-sourcing framework). Optional tiny `PreparationActivity` only if UNION queries get ugly. |
| Questions UI (journey + per stage) | “What they asked” is the durable asset. |
| Stage completion from Log Interview | Mark stage `COMPLETED`, optional schedule/activate next, stamp `completedAt`. |

### Still not in B (and why)

| Deferred | Why wait |
|----------|----------|
| Elevate/Replay FKs, `Session.mode` / `scenario` | Phase **C1** plumbing. B must not edit the agent or `Elevate.tsx`. |
| Prep Advisor / Bedrock | Needs B data first; Phase **E**. No RAG. |
| Deterministic recommendations | Phase **D** — needs questions + dates + later practice scores. |
| Resume Claims | Valuable but not required to validate “log the round.” Don’t block B. |
| Career profile file extract / versions | **Phase F.** A is paste-only; B does not add S3/PDF. |
| Prep Sprint / Gap Engine / Intake LLM | **D1/D2/E.** B only stores what happened. |
| LinkedIn scrape | Still paste-only. |
| Cross-company Advisor | Not v1. |
| Python agent / role-play | Phase **C2**. |

---

## Users and jobs

**Job-to-be-done:** “The round just happened. I dump what I remember. SpashtAI keeps it attached to this company and stage.”

Anti-job: ATS “add artifact to pipeline entity.”

---

## Domain (on top of A)

```text
PreparationStage
  ├── StageReflection?     (editable; includes optional surprisedBy)
  └── InterviewQuestion[]

InterviewQuestion
  questionText
  source: ACTUAL_INTERVIEW | PRACTICE | USER_ENTERED | AI_SUGGESTED
  category? topic? difficulty? notes?
  askedAt?
  stageId?
  # optional v1: needsPractice Boolean
```

**Multiline capture:** one line = one question; trim bullets; skip blanks.

**Stage status from A.** Logging a round: that stage → `COMPLETED` + reflection + questions. **Do not** retroactively set SKIPPED stages to COMPLETED unless the user says they actually happened.

List/detail still use A’s `lastCompletedStage` / `nextStage`. After log-interview, recompute: last completed = this stage; next = following incomplete.

---

## Primary UX: Log Interview

Prominent on journey detail (and stage): **Log Interview**.

Fast form:

1. Which stage? (default: **nextStage** / the stage they opened)
2. How did it go? (Very Poor → Excellent **and/or** outcome PASSED / REJECTED / PENDING / UNKNOWN)
3. What went well?
4. What was difficult?
5. **What surprised you?** (optional but encouraged — often the highest-value signal, e.g. “expected system design, got underperformer management”)
6. What did they ask? (textarea, multiline → many `InterviewQuestion` `ACTUAL_INTERVIEW`)
7. Feedback / clues / next-round hints
8. Next interview date? (optional → set next incomplete stage `SCHEDULED`)

Submit **atomically**: reflection + questions + stage status (+ optional next schedule). One toast. Back to journey with timeline updated.

Empty states: no questions yet; explain why capture matters.

Filters (journey Questions tab): All / Actual / Practice (Practice empty until C). Don’t fake “needs practice” if the field doesn’t exist yet.

---

## Timeline (Overview)

Chronological, from existing rows, e.g.:

- Recruiter completed  
- Added 4 questions  
- Reflection: Good  

No LLM. No fake “Prep recommendation updated” until D.

---

## API (adapt to A’s real prefixes)

Ownership: always via parent Preparation. Unowned → 404.

```text
GET/POST   /api/preparations/:id/questions
PATCH/DELETE /api/preparations/:id/questions/:questionId

PUT/PATCH  /api/preparations/:id/stages/:stageId/reflection

POST       /api/preparations/:id/log-interview
           { stageId, rating?, outcome?, wentWell?, difficulties?,
             surprisedBy?, feedbackReceived?, nextRoundHints?, questionsText?,
             nextStageScheduledAt? }
```

Prefer **one** `log-interview` command for the product flow; keep granular question CRUD for edits.

Detail payload (extend A’s summary): recent timeline, question counts by stage, reflection present/absent. Still **no** full transcripts.

---

## Security / logging

Same IDOR rules as A. Tests:

- A cannot read/write B’s questions or reflections  
- A cannot log-interview on B’s stage  
- `log-interview` cannot attach questions to another user’s stage  

**Do not log** JD, resume, question text, or reflection bodies. Events only: `prepare.question_added` (count), `prepare.stage_completed`, `prepare.interview_logged`.

---

## Tests

Extend the **same** Vitest harness from A. Do not start a second framework.

Functional: multiline questions split correctly; logging completes stage; next date schedules next stage; current-stage algorithm still holds.

---

## Blast radius

**Do not touch:** agent, `Elevate.tsx` (except maybe a later unused query param — **no**), Replay, Pulse, Session columns, Bedrock.

**May touch:** Prepare pages from A, new components (`LogInterviewDialog`, `QuestionMemory`, `StageReflection`, timeline), Prepare routes/services, Prisma + migration.

---

## Acceptance

- [ ] Log Interview on a journey/stage is the obvious action  
- [ ] Questions persist, grouped by stage, listed at journey level  
- [ ] Reflection persists including optional **What surprised you?**; outcome ≠ stage status  
- [ ] Timeline shows completions + questions + reflections  
- [ ] Multiple journeys stay isolated  
- [ ] IDOR tests for questions/reflections/log-interview  
- [ ] Flag still gates Prepare  
- [ ] A’s create/list/edit stages still work  

**Stop after B.** Phase C1 (session FKs + return-to-journey) is a separate prompt.

---

## Binding after A ships

When drafting the **implementation** prompt for B, replace conceptual URLs with A’s real paths, Prisma enum names, and Zod schemas. If A used Move Up/Down and a specific detail tab structure, Log Interview should live on that shell—not a second layout.
