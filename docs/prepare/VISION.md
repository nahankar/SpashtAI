# Prepare — product vision

**Interface:** conversation  
**Memory:** Interview Journey  
**Intelligence:** readiness / gaps  
**Action:** Prep Sprint  
**Practice:** Elevate  
**Learn from reality:** Log Interview + Replay  

This is **not** an ATS, not a generic interview chatbot, and not another Elevate skill drill.

```text
                 PREPARE
                    │
             Conversation
                    │
                    ▼
           Interview Journey
              persistent memory
                    │
        ┌───────────┴───────────┐
        │                       │
   Know the user           Know the interview
 Pulse / Replay /          JD / stage / date /
 Elevate / profile         interviewer / history
        │                       │
        └───────────┬───────────┘
                    ▼
             Readiness / Gaps
                    │
                    ▼
               Prep Sprint
                    │
                    ▼
                 Elevate
                    │
               assess result
                    │
          update remaining sprint
                    │
                    ▼
            Real Interview
                    │
         Log Interview / Replay
                    │
                    ▼
                Next Round
```

**Journey remembers. Gap Engine reasons. Sprint decides what matters now. Elevate practices it. Reality updates the Journey.**

NORTHSTAR Layer 7 (Ask Your Journey / RAG) stays parked. Prepare intelligence is **one journey + this user’s existing SpashtAI records**, assembled with token limits — not a vector index over all history.

---

## The feeling

The user should not think: “Create a Preparation entity, select Technical, upload JD, then run Elevate.”

They should say:

> I have a Google Senior Engineering Manager interview next Thursday.

Prepare updates the journey **underneath**, asks only for missing high-value facts, then (D2+) builds a **Prep Sprint** sized to remaining time.

---

## Phase roadmap

| Phase | Outcome |
|-------|---------|
| **A** | Journey foundation + conversational **shell** (no LLM, no file extract) |
| **B** | Learn from real interviews: questions + reflections (+ what surprised you) |
| **C1** | Elevate / Replay linkage |
| **C2** | Interview role-play scenarios |
| **D1** | Readiness / Gap Engine |
| **D2** | Prep Sprint **generator** (uses D1; schema designed now, built in D2) |
| **D3** | Adaptive sprint after practice |
| **E** | Prep Advisor + Intake Agent (NL → structured fields + confidence) |
| **F** | Career profile **versions** + file extract, multi-interviewer, polish |

Sprint generation must **not** be “LLM, make a 2-day plan.” It is:

```text
facts → preparation needs → readiness → priorities → available time → activities
```

---

## Conversation (A vs E)

**A:** conversation-shaped **progressive fields and chips**. Composer can hold free text as *notes to themselves*, but company and role are **explicit fields** (pre-filled only if the user typed them into labeled inputs). **No regex mini-parser** for company/role/acronyms — it will be thrown away when the Intake Agent exists.

**E — Intake Agent:** NL → JSON with per-field `confidence` and `missing[]`. High confidence can confirm (“Is this right?”); low confidence asks. Conversation-first UX ≠ NLU in Phase A.

**Never scrape LinkedIn.**

---

## Profile / resume

**Phase A:** paste only on the journey:

```text
InterviewPreparation.resumeText?
InterviewPreparation.resumeLabel?   // e.g. "EM 2026" — optional display name
```

UX: “Profile / resume for this role — optional. Paste text. We use it only to personalise preparation.” Different journeys may have different pasted text. No library, no PDF, no multer extract.

**Phase F — immutable versions (do not snapshot full CV onto every journey):**

```text
UserCareerProfile          id, userId, name
UserCareerProfileVersion   id, profileId, originalFileName, extractText, createdAt
InterviewPreparation.careerProfileVersionId
```

Google stays on version 3; Microsoft on 4; an update creates version 5. **Never keep the raw file** — extract + filename + date on the **version** row, then delete temp bytes.

---

## Interviewer

**Phase A:** **one optional interviewer per stage** (`interviewerName`, `interviewerRole`, `interviewerProfileText`). Documented limit — not the complete interview model.

**Later:** `PreparationInterviewer` + stage join for panels / Amazon loops. Do not assume A schema was complete.

**Privacy (lock this):**

> Interviewer context may influence likely **professional topic emphasis** only.  
> It must **not** be used to infer personality, protected characteristics, cultural background, hiring preferences, psychological profile, or likelihood of candidate success.

Language: “worth preparing”, never “will ask” / “Rahul likes aggressive candidates.” Interviewer weight must **not dominate** JD × stage × gaps.

---

## Stage semantics (A)

Statuses: `UPCOMING` · `SCHEDULED` · `COMPLETED` · `SKIPPED`.

Selecting “I’m at Technical” must **not** invent completed Recruiter/Applied interviews.

**v1:** earlier autogenerated stages → `SKIPPED`; current → `UPCOMING` or `SCHEDULED` if a date exists. User can fix history if they care.

Server exposes:

```text
lastCompletedStage
nextStage            // next actionable: earliest incomplete SCHEDULED, else first incomplete by sequence
```

UI: **“Next: Hiring Manager — Sep 10”**. Do not invent a fuzzy `currentStage` that mixes last done and next up.

---

## Prep Sprint — conceptual schema (design now, implement D2)

Not a “course.” A sprint can be 10 minutes or 10 days.

```text
PrepSprint
  id, preparationId, stageId?
  status
  generatedAt, interviewAt?, availableMinutes, version

PrepActivity
  id, sprintId
  type, title, reason
  estimatedMinutes, priority, sequence
  status, completedAt?
  sourceJson?, linkedSessionId?
```

`version` matters: v1 architecture + mock; after mock, v2 drops architecture, adds conciseness drill.

Time buckets and stage-specific content: see below. Generator is **D2**; adaptive rewrite **D3**.

| Time to interview | Shape |
|-------------------|--------|
| ~30 min | Warm-up only. No new learning. |
| ~24 h | 60–90 min: positioning, few stories, one short sim, questions to ask |
| ~2–7 days | Stage-specific modules + one mock + weak-area drills |
| ~10+ days | Deeper JD/profile coverage + two mocks — still not a 20-module academy |

Stage still changes the plan (recruiter ≠ HM ≠ HR) even with the same JD.

---

## Gap Engine (D1) — two readiness dimensions

Pulse **must not dominate**. “No underperformer story” is not a Pulse skill.

### Communication readiness (existing Pulse / Elevate)

clarity, confidence, structure, conciseness, engagement, pacing

### Interview-content readiness

leadership evidence, technical depth, people management, stakeholder conflict, strategy, motivation, role fit, **specific JD themes**

Differentiate:

> Your stakeholder-conflict story is relevant and strong, but you deliver it with too much detail.

Conceptual need:

```text
PreparationNeed
  topic                  e.g. stakeholder_management
  importance             0–1 (JD × stage × interviewer professional emphasis)
  sources                JD, stage, interviewer_context, notes
  evidence               resume / elevate / replay / notes  (none → gap)
  readiness              0–1
  confidence             0–1
  recommendedAction      practice | review | skip
  estimatedImprovementTime
```

User sees **Preparation Priorities**, not the matrix.

Sprint = select activities that reduce the **highest-value** gaps subject to **available minutes**.

---

## Shared context (later)

One builder; several views. Do not invent two memory systems.

Elevate launch: `preparationId + stageId + scenario + mode` only — never JD/resume in the URL.

---

## What this does not change

- Prepare is not `Session.module`  
- No vector DB  
- No LinkedIn API as v1  
- Pulse stays the six communication skills (no `interview_skill` score)  
- Python coach templates stay skills; role-play is C2 `scenario_templates`
