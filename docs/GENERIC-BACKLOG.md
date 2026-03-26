# Generic Backlog

## 2026-03-25

### 1) Remove Replay Context Fields (Deferred)

#### Goal
Remove these Replay context fields end-to-end for a simplified workflow:
- `meetingType`
- `userRole`
- `focusAreas`
- `meetingGoal`

Keep only:
- `sessionName`
- `participantName` (required)
- `meetingDate` (auto-detect from VTT metadata when possible; otherwise required before analysis)

#### Why deferred
These fields are still referenced in:
- DB schema (`ReplaySession`)
- API contracts
- Bedrock prompt shaping (`apps/server/src/lib/aws-bedrock.ts`)
- UI/history surfaces

A safe removal needs coordinated backend + frontend + DB migration.

#### Planned implementation (later)
1. **Backend prompt updates**
   - Update `apps/server/src/lib/aws-bedrock.ts` to remove prompt dependencies on:
     - meeting type criteria map
     - user role line
     - focus areas line
     - meeting goal line
   - Replace with neutral/general coaching criteria.
2. **API contract cleanup**
   - Remove properties from create-session payload, replay response shapes, and related TypeScript interfaces.
3. **DB migration**
   - Prisma migration to drop columns from `ReplaySession`:
     - `meetingType`
     - `userRole`
     - `focusAreas`
     - `meetingGoal`
4. **Frontend cleanup**
   - Remove display of these fields from replay context, history, and results views.
5. **Regression checks**
   - Create session -> upload -> process -> results
   - Reprocess flow with cache
   - Participant fallback to dominant speaker
   - Progress Pulse chronology by `meetingDate`

#### Acceptance criteria
- Replay works without these 4 fields anywhere in UI/API/DB.
- No TypeScript errors, no Prisma runtime errors.
- Bedrock analysis quality remains acceptable with generalized prompt context.

#### Risks / notes
- Removing context can reduce prompt specificity for some scenarios.
- If needed later, reintroduce as optional metadata (not required DB columns).

---

### 2) Remove DEV-Only AWS Transcribe Streaming Path Before Production

#### Goal
Remove all development-only transcription code paths and revert to production-safe AWS Transcribe flow.

#### Scope
- Remove `apps/server/src/lib/aws-transcribe-streaming.ts` and its usage.
- Remove DEV-only branching in `apps/server/src/routes/replay.ts` for streaming.
- Ensure only production path remains:
  - upload audio to S3
  - run batch AWS Transcribe
  - fetch result
- Clean up DEV-only comments/banners and related fallback behavior.

#### Validation
- Replay processing works end-to-end in prod mode with S3 + batch Transcribe.
- No references to `aws_transcribe_streaming` remain in code, responses, or metrics source labels.
- Typecheck/lints pass and replay regressions are clean.
