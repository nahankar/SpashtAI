# Interviews usability update — practice defaults, plan durations and recording acknowledgment

Branch `codex/interviews-usability-defaults-consent` (from main `bd8eabf`). Not merged or deployed.

## Practice time by plan (server-verified)

| Plan (from the stored account, never the token) | Practice times offered | Default |
| --- | --- | --- |
| Ultra (`enableUltra`, or an Admin role) | 5, 10, 15, 30 minutes, no time limit | **No time limit** |
| Pro (`enablePro` without Ultra) | 5, 10, 15, 30 minutes | **30 minutes** |
| Neither | 5, 10, 15 minutes | 10 minutes |

Ultra takes precedence when both switches are on. `POST /runs` resolves an omitted duration to the plan default
and refuses (403 `DURATION_NOT_ALLOWED`) a time the plan does not include. "No time limit" is stored explicitly
as `durationMinutes = NULL` (migration `20261027090000_interview_unlimited_duration`: nullable column and an
updated `InterviewRun_setup` check allowing NULL or 5/10/15/30). Such a practice never ends by time, the voice
state sends `secondsRemaining: null`, and the agent starts no timer. Existing practices keep their stored
minutes; pause and resume behave as before.

**Consequence to decide (not changed here):** `enablePro` and `enableUltra` both default to **true** for new
accounts (`schema.prisma`), so every new learner currently gets Ultra and therefore defaults to **no time
limit**. Changing license defaults is a separate product decision.

**Separate decision:** the eight-question cap (`maxQuestions = 8`, also a database check) is unchanged. No time
limit is not unlimited questions; the setup label says "No time limit (up to 8 questions)".

## Setup and recent history

Difficulty starts at All supported difficulties. The "eligible questions · up to 8 · pauses" line is removed;
loading, access and no-matching-question messages remain. The landing page keeps the latest three practices;
full History keeps pagination, filters and deletion.

## Release

Publishing the approved Terms and Privacy additions is part of releasing this branch. Follow
`POLICY-INTERVIEWS-RECORDING.md` §7 after the deploy checks pass.
