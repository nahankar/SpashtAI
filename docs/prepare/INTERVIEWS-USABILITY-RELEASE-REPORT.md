# Interviews usability update — release report (26 Oct 2026)

**Production has not changed.** Nothing on this branch is merged or deployed.

| | Revision | How checked |
| --- | --- | --- |
| Branch `codex/interviews-usability-defaults-consent` | `048473f` before this report's commit (local and GitHub match) | `git fetch` |
| GitHub `main` | `bd8eabf` | `git fetch` |
| EC2 `/opt/spashtai` | `bd8eabf`, API health 200, none of this branch's `20261027*` migrations present | read-only SSH; only modified tracked files are the preserved production LiveKit overlays (`infra/livekit/livekit.yaml`, `egress.yaml`) |

## Commits not in main (oldest first)

`4512539` compact voice rows, All difficulty · `cf276f1` plan-based practice time · `dfc5182` recording acknowledgment ·
`195bfb1`, `69a455a` approved policy text and release step · `be47d58` Show conversation toggle · `6bde486` recognizer
restart · `47bf9ac` no reminder near Start · `3aabbfc` no fixed question count · `ac68cde` plan labels, history buttons ·
`a5988d5` provider-neutral wording, acknowledgment v2 · `cc8e9cb` mid-utterance stall detection · `83805b5` teardown
cleanup · `048473f` local-only recognizer fault switch.

## Automated checks (actual results)

- Server: 648 passed, 4 skipped (PostgreSQL test database); typecheck clean.
- Web: 309 passed; typecheck, lint and production build pass.
- Agent: 219 passed, twice, with **zero** "Task exception was never retrieved" lines in the full output.
  The new teardown tests install an event-loop exception handler and fail on any unretrieved task exception or
  leftover task. Against the previous code, two of them fail with exactly that loop error; with `83805b5` all pass.
- **Fresh installation verified** with the supported procedure (`INTERVIEWS-PHASE-0.md`, "Empty installation"): a
  new empty disposable database, `DATABASE_URL` set explicitly, `initialize-empty-database.mjs`, then
  `npm --workspace apps/server exec prisma migrate deploy`. Result: all later migrations applied, `migrate status`
  up to date, `prisma migrate diff` against `schema.prisma` reported no difference (exit 0), and rerunning the
  initializer refused the populated database. The new run check (`maxQuestions` NULL or 8), the per-attempt limit
  trigger and the version-agnostic consent rule were present. The database was then dropped. (The earlier report's
  statement that a fresh install could not be verified was wrong: plain `migrate deploy` cannot build an empty
  database, which is why the initializer exists.)
- Upgrade with existing data: the local development database migrated cleanly; its 16 existing practices keep
  `maxQuestions = 8` and its earlier `interview-recording-ai-1` acceptance is unchanged.

## Browser checks (local app, disposable test learners, since deleted)

| Check | Result |
| --- | --- |
| Ultra options and default | 5, 10, 15, "30 minutes · Pro", "No time limit · Ultra"; default No time limit; Difficulty All; daily feedback limit stated |
| Pro options and default | 5, 10, 15, "30 minutes · Pro"; default 30; a Pro request for no time limit is refused by the server (403 `DURATION_NOT_ALLOWED`) |
| Acknowledgment | Provider-neutral v2 text shown once; after "I agree" and reload: no card, no checkbox, no reminder, Start enabled; server returns `interview-recording-ai-2` with a timestamp. The other learner still sees its own card |
| More than eight questions | A new practice (stored `maxQuestions` NULL) reached an 11th question through the real practice service and shows "10 skipped · 1 incomplete"; a practice stored with limit 8 refused the 9th (`PRACTICE_QUESTION_LIMIT`) and shows "8 skipped" |
| History buttons | Top "Interview history" is an outlined rounded button; with 2 practices no "Load more"; with 4, "Load more" (outlined) appears, the landing page keeps 3 rows, and it opens `/interviews/history` listing all 4; no "View all" link |
| Narrow screen | No horizontal overflow at 375 px |

The practices were created through the server's practice service functions (start, prepare, asked, receipt, skip,
end), not through a voice session, because the browser pane blocks microphone access.

## Not yet verified (needs a real microphone)

- Show conversation ON by default and toggling while the interviewer speaks and while answering, including automatic
  progression to the next question.
- Recognition notices in a live session. Use the local-only fault switch (refused in production or off localhost):
  stop the local agent and start it with `SPASHTAI_DEV_STT_FAULT=stall-once` (expected: silent recovery, both parts of
  the answer saved once) or `stall-repeatedly` (expected: "Speech recognition is not responding…", cleared when the
  fourth stream recovers; with more than about 20 s of continuous speech beyond the replay bound, an "about N seconds
  could not be transcribed" notice). Remove the variable afterwards.

## Recovery evidence: synthetic vs real

- **Synthetic (reproducible):** scripted recognizers in unit tests and one integration test through the real voice
  path (`stt_node`, capture, coordinator): a stream that returns words and then silently stops while speech continues
  is replaced, the answer is saved once with no duplicate, and nothing reaches the next question.
- **Real service dropout:** observed once on 26 Oct 2026 at 19:18 (Amazon Transcribe stopped returning results; the
  error surfaced at 19:20) before the watchdog existed. Recovery from a real dropout **has not been observed**; it
  cannot be triggered on demand. If it recurs, the agent log shows `interview_stt restarted`.

## Limitations and open decisions

- Replay is bounded to 20 s; speech older than that during a long outage stays in the recording but is not
  transcribed, and the learner is told roughly how many seconds.
- Continuous non-speech sound detected as voice (for example a TV) can cause harmless restarts and, after two, the
  "not responding" notice.
- Learner feedback stays limited to 30 answers per day; longer practices can reach it.
- Grading remains experimental; recording loss on refresh (D-1) remains open.
- Release still needs explicit authorisation; at release, publish the Terms/Privacy additions per
  `POLICY-INTERVIEWS-RECORDING.md` §7 (Privacy §3 now uses the provider-neutral wording).
