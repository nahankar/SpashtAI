# Prepare — product docs

**Journey remembers. Gap Engine reasons. Sprint decides what matters now. Elevate practices it. Reality updates the Journey.**

This is **not** an ATS, not a generic interview chatbot, and not another Elevate skill drill.

See **[VISION.md](./VISION.md)** for the locked architecture.

```text
Replay  → Understand
Elevate → Improve
Prepare → Perform
Pulse   → Grow
```

NORTHSTAR Layer 7 (RAG) stays parked.

## Phases

| Phase | Doc | Ships |
|-------|-----|--------|
| **A** | [PHASE-A.md](./PHASE-A.md) · [checklist](./PHASE-A-REVIEW-CHECKLIST.md) · [**technical plan**](./PHASE-A-TECHNICAL.md) | Journey + conversational **shell**. No files, no NLU |
| **B** | [PHASE-B.md](./PHASE-B.md) | Log Interview, questions, reflections |
| **C1 / C2** | VISION | Prepare-owned Elevate links + bounded context; then role-play |
| **D1 / D2 / D3** | VISION | Gap Engine → Sprint generator → adaptive sprint |
| **E** | VISION | Advisor + Intake Agent |
| **F** | VISION | Profile **versions** + extract; multi-interviewer |

Keep each phase independently reviewable; do not pull later-phase intelligence into an earlier slice.

## Locked

- Practice sessions stay `Session.module = elevate`
- C1 linkage stays in `PreparationPractice`; deleting a journey never deletes an Elevate session
- Elevate launch: IDs only (`preparationId`, `stageId`; later `scenario`, `mode`)
- `InterviewPreparation` 1:1; no interview fields on generic `Preparation`
- Flag `prepare`, seed **hidden**; no new billing
- A resume = **paste** (`resumeText` / `resumeLabel`); file library is F
- No LinkedIn scrape; interviewer text = professional emphasis only (see VISION privacy)
- Jumping into a late round → earlier stages **SKIPPED**, not fake COMPLETED
- API: `lastCompletedStage` + `nextStage`
- No Python agent in A or B
