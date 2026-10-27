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

## Question count (no fixed cap for new practices)

New practices store `maxQuestions = NULL` (migration `20261027110000_interview_open_question_count`). A timed
practice continues until its active time expires, the learner ends it, or no eligible unasked question remains
(`QUESTION_BANK_EXHAUSTED`; no question is generated). "No time limit" has neither a time nor a question limit.
Practices created earlier keep their stored `maxQuestions = 8`; a trigger enforces that stored limit on every
attempt insert, and the run check now allows only NULL or 8. The attempt index check is `index >= 1`.
No-repeat selection, ownership, access and evaluation budgets are unchanged.

**Evaluation quota:** learner technical feedback stays limited to 30 answers per learner per day (300 across all
learners). Longer practices can reach it. Answers past the limit are saved and labelled "Technical feedback ·
Daily limit reached" rather than graded or shown as a generic failure, and setup states the daily limit. The quota
was not raised.

## Setup and recent history

Difficulty starts at All supported difficulties. The "eligible questions · up to 8 · pauses" line is removed;
loading, access and no-matching-question messages remain. The landing page keeps the latest three practices;
full History keeps pagination, filters and deletion.

## Release

Publishing the approved Terms and Privacy additions is part of releasing this branch. Follow
`POLICY-INTERVIEWS-RECORDING.md` §7 after the deploy checks pass.

## Short untranscribed sounds (bounded wait)

Automatic conversation used to wait indefinitely when voice activity produced no transcript at all (a breath,
click or cough), showing "Some speech has not been transcribed yet". It now uses a bounded wait **only** when the
answer already has confirmed words, the untranscribed voice activity totals at most **1.5 s**, no partial text is
pending, and the recognizer is neither recovering from a restart nor reporting a transcription gap for the
answer. After **3 s** of quiet the normal **5 s** handoff countdown starts; the save then waits for late finals
and still waits the full 8 s barrier for any partial text. Renewed speech, any recognizer result, More time,
a restart or a reported gap cancels it. With no confirmed words nothing is finished or skipped automatically.

The ignored sound stays in the recording and is logged as `saved_ignoring_untranscribed_sound`; it is never
reported to the learner as lost words. **Remaining risk:** a short sound cannot always be told apart from a short
word. A word the recognizer never transcribes within about 8 s (3 s wait + 5 s countdown) is left out of the saved
answer, although the recording keeps it. Sustained speech (over 1.5 s) without a transcript is never finished
automatically; the recognizer watchdog restarts the stream or reports that recognition is not responding.
