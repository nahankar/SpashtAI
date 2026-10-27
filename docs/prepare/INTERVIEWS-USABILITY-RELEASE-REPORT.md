# Interviews usability update — release report (26–27 Oct 2026)

**Released 27 Oct 2026:** GitHub `main` fast-forwarded to `e1f9d19` (from `bd8eabf`; no intervening commits) and
deployed to EC2 with `infra/ec2/deploy.sh`. EC2 `/opt/spashtai` is at `e1f9d19` on `main`.

| | Revision | How checked |
| --- | --- | --- |
| GitHub `main` | `e1f9d19` | `git fetch`, after the push |
| EC2 `/opt/spashtai` | `e1f9d19`; only modified tracked files are the preserved LiveKit overlays (`infra/livekit/livekit.yaml`, `egress.yaml`) | read-only SSH after deploy |
| This report | committed to the release branch after `e1f9d19` (documentation only; not on `main` or EC2) | — |

### Deployment record

- **Pre-checks:** no open voice segment in the last 3 hours and no active interview practice; `SPASHTAI_DEV_STT_FAULT`
  absent from the env files, the PM2 config and every agent process (before and after the deploy).
- **Backup:** `~/spashtai-backups/usability-e1f9d19-20261027` on EC2 (mode 700): `database.dump` (pg_dump custom
  format, 56 table-data entries; restored in full into a temporary database during verification, then dropped),
  copies of `apps/server/.env`, `apps/agent/.env`, `.env.bak`, `infra/ec2/env/postgres.env`, the two LiveKit overlays,
  `before.json`/`after.json` snapshots and `cutoff.txt`.
- **Migrations (maintenance window, API and agent stopped):** `20261027090000_interview_unlimited_duration`,
  `20261027100000_recording_acknowledgment`, `20261027110000_interview_open_question_count`,
  `20261027120000_recording_acknowledgment_versions`, all applied; `migrate status` reports the schema up to date.
- **Services:** API health `{"status":"ok"}` (local and `https://api.spasht.ai/health`), agent registered with LiveKit;
  no new errors in the API or agent logs. Recurring "prosody … Broken pipe" lines for one old Elevate session predate
  the deploy and are unrelated.
- **Data preserved (checksums before vs after):** question bank (1649), feature flags, grants (6), answer snapshots,
  finished assessments, voice config, legal documents and user plans unchanged. The 5 existing interview runs keep
  every original column (compared against the restored dump) and their stored `maxQuestions = 8`; the only change is
  the two new consent columns, empty on all 5. Feature access unchanged (flags hash identical); nothing broadened and
  adaptive/generated questions not enabled by this release.
- **Web:** the served bundle contains the plan labels, Show conversation, Load more and recognition notices, and no
  longer contains the question card, "up to 8 questions" or the reminder near Start. The server runs acknowledgment
  `interview-recording-ai-2` (the ai-1 text is kept verbatim only for verifying earlier acceptances).
- **Terms/Privacy published 27 Oct 2026** by the user in Admin → Legal, after the live text was re-checked against the
  reviewed 2026-06-23 baseline (both hashes matched; no intervening edits). Verified through the public API: titles
  unchanged, stored text identical to the approved provider-neutral text (SHA-256 terms `d8ab386e…6dd6`, privacy
  `41f03e24…16cd`), `Last updated: 2026-10-27`, no provider named; updated 18:18:08 and 18:18:21 UTC.

### Remaining production checks

- With the user's account: setup labels and defaults, acknowledgment (shown once for the new version), history
  buttons, Show conversation, no question card; a short normal microphone practice (no fault injection in production);
  confirm the new practice stores no question limit.

## Commits released (oldest first)

`4512539` compact voice rows, All difficulty · `cf276f1` plan-based practice time · `dfc5182` recording acknowledgment ·
`195bfb1`, `69a455a` approved policy text and release step · `be47d58` Show conversation toggle · `6bde486` recognizer
restart · `47bf9ac` no reminder near Start · `3aabbfc` no fixed question count · `ac68cde` plan labels, history buttons ·
`a5988d5` provider-neutral wording, acknowledgment v2 · `cc8e9cb` mid-utterance stall detection · `83805b5` teardown
cleanup · `048473f` local-only recognizer fault switch · `23bdaaa` first release report · `452a889` stale short sounds
and speech-only gap measurement · `7ac74eb` bounded wait for isolated short untranscribed sounds.

## Automated checks (actual results)

- Server: 648 passed, 4 skipped (PostgreSQL test database); typecheck clean.
- Web: 309 passed; typecheck, lint and production build pass.
- Agent: 254 passed (latest run, 27 Oct) with zero "Task exception was never retrieved" lines; earlier 219 passed, twice, with **zero** "Task exception was never retrieved" lines in the full output.
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

## Live microphone checks (27 Oct 2026, local app, the user speaking, the agent handled by Claude)

Local development only; production untouched. Fault injection used the local-only switch
(`SPASHTAI_DEV_STT_FAULT`, refused in production or off localhost), was set only for Runs 2 and 3, and was removed
afterwards (agent restarted without it; variable absent from the agent processes; no fault log line).
**Runs 2 and 3 are injected failures through the live microphone path, not observed recovery from a spontaneous
service outage.**

| Run | Setup | Observed | Saved data |
| --- | --- | --- | --- |
| 1 | Fault off | Show conversation defaulted ON; toggling while the interviewer spoke and while answering did not interrupt speech, recording or progression, and hidden messages reappeared (user-confirmed). **Defect found:** a 0.7 s sound with no transcript after a complete answer held it on "speech not transcribed yet" for about 45 s; when the user spoke again the watchdog restarted a working recognizer and showed a false "about 35 seconds could not be transcribed" notice (silence counted as speech) | 6 answers in order, no duplicates, nothing in the next question; recording 307 s available |
| — | Fixes | `452a889`: stale short sounds no longer count towards owed speech; untranscribed time counts detected speech only. `7ac74eb`: bounded wait (thresholds below) | — |
| 1b | Fault off, repeat | Confirmed answer → 0.76 s sound → about 8 s later saved and advanced automatically, no loss notice, no restart (`saved_ignoring_untranscribed_sound`); a short "Yes." kept; a sound before any confirmed words did not trigger the shortcut | 4 answers, no duplicates; recording 134 s available |
| 2 | `stall-once` | Each question's first stream stopped after its first sentence; the watchdog replaced it (Q1 at about 13 s, 11.6 s resent, 0 lost; Q2, 12.7 s resent, 0 lost); later sentences appeared in a burst; no notice (silent recovery); progression resumed | Q1 4 sentences and Q2 4 utterances in order, no duplicates, nothing crossed questions; recording 125 s available |
| 3 | `stall-repeatedly` | Restarts at about 13 s (lost 0), 28 s (lost 2.8 s, "could not be transcribed" notice, then "Speech recognition is not responding") and 55 s (lost 28.3 s, notice); the fourth stream recovered at about 60 s and "not responding" cleared; the gap notice stayed | 7 sentences in order, no duplicates. About 31 s of speech during the outage is **not** in the transcript (matching the two gap reports) but remains in the 173 s recording. Not complete transcription recovery |

After the reported gap the answer still completed by the normal 5 s handoff once recognition recovered (the gap only
disables the short-sound shortcut); Q2 had no speech, so Finish was refused ("no speech") three times and the user
skipped it. AWS library lines `InvalidStateError … awscrt/aio/http.py` ("Exception ignored") appear when streams
close at question changes; they come from the third-party library and were present before these changes.

**Short-sound bounded wait (thresholds):** applies only when the answer has confirmed words, untranscribed voice
activity totals at most 1.5 s, no partial text is pending, and there is no restart or reported gap; 3 s of quiet,
then the normal 5 s handoff; late finals and partial text are still waited for. Remaining risk: a short word the
recognizer never transcribes within about 8 s is left out of the saved answer (the recording keeps it).

## Recovery evidence: synthetic, injected and real

- **Synthetic (reproducible):** scripted recognizers in unit tests and an integration test through the real voice
  path (`stt_node`, capture, coordinator).
- **Injected through the live microphone path:** Runs 2 and 3 above.
- **Real service dropout:** observed once on 26 Oct 2026 at 19:18 (Amazon Transcribe stopped returning results)
  before the watchdog existed. Recovery from a spontaneous dropout **has not been observed**.

## Limitations and open decisions

- Replay is bounded to 20 s and replacements back off (6, 12, 24, 30 s), so a long outage loses transcription of
  earlier speech (31 s in Run 3); it stays in the recording and the learner is told roughly how many seconds.
- Continuous non-speech sound detected as voice (for example a TV) can cause harmless restarts and, after two, the
  "not responding" notice.
- Learner feedback stays limited to 30 answers per day; longer practices can reach it.
- Grading remains experimental. Recording loss on refresh (D-1) remains open in production; a fix is on branch `codex/interviews-reliability-d1` (see below), not yet released.
- Release still needs explicit authorisation; at release, publish the Terms/Privacy additions per
  `POLICY-INTERVIEWS-RECORDING.md` §7 (Privacy §3 now uses the provider-neutral wording).

## Next update: Interviews reliability (branch `codex/interviews-reliability-d1`, 28 Oct 2026) — not merged or deployed

Built from `main` `e1f9d19` (plus this report's two documentation commits). Three reviewable commits:

| Commit | Change |
| --- | --- |
| `ac5d5cc` | Technical feedback only after practice ends, in playback. Both learner assessment API paths return a neutral `AFTER_PRACTICE` state with no status or content until the session ends (a pause is not an end). The practice page never shows feedback and links to playback after End. The "This preview saves…" paragraph is removed. Budgets unchanged; personal vs shared daily limits are recorded distinctly, and playback names each unavailable cause (your limit, shared limit, legacy limit, service failure, disabled, incomplete transcript). |
| `b95da5e` | Transcript integrity persisted per answer (`InterviewTranscriptIssue`, migration `20261028090000`): confirmed gaps (estimated seconds of detected speech), unresolved recognition, recovery, accepted unconfirmed speech, ignored short sounds; saved before the completion receipt; never moved to another answer. Incomplete transcripts are never graded (`TRANSCRIPT_INCOMPLETE`, no model call or budget), re-checked at claim, result and display; a recovery never clears a gap; stored evaluations are not rewritten. |
| `74d763d` | D-1 fix: recoverable local recording journal in the shared recorder (Interviews and Elevate). Details, deletion policy and limits: `INTERVIEWS-RECORDING-RECOVERY.md`. At most about 1 s (the current timeslice) plus one local write is unpersisted at a crash. |

**Checks (actual):** server 654 passed, 4 skipped; agent 257 passed (zero unretrieved-task warnings); web 318
passed, typecheck, lint and build pass. The new migration passes the supported empty-installation procedure
(`migrate diff` exit 0) and upgraded the local development database cleanly. Browser checks with a generated tone
and disposable accounts (since deleted): a page reloaded mid-recording was recovered by the app to its original
segment (server decoded 15.24 s of Opus 48 kHz); a live recording was refused; two concurrent recoveries made one
upload; another account's journal stayed untouched until that account signed back in; a deleted practice dropped
the local copy.

**Unresolved risks:**
- Recovery depends on IndexedDB and Web Locks (fallback: 2 minutes of inactivity); without IndexedDB there is none.
- Signing in as another account without signing out leaves the previous account's journal in the browser for up to
  7 days. The acknowledgment and Privacy Policy do not yet mention temporary local recovery storage; proposed
  wording is in `INTERVIEWS-RECORDING-RECOVERY.md` (needs approval, a new acknowledgment version and a republish).
- Gap seconds are estimates of detected speech; continuous non-speech sound detected as voice can still cause
  restarts and notices.
- Grading remains experimental; adaptive interviewing and grading-prompt rewrites are out of scope.

**Human microphone checks needed before release (local, then production):**
1. Feedback timing: during practice and while paused, no technical feedback anywhere; after End, playback shows it
   collapsed under each answer; the ended practice page shows only the playback link.
2. Refresh mid-answer and between questions: the reloaded page recovers the recording to the original segment;
   playback plays it; nothing is attached to a later question.
3. Two tabs open on the same practice during a reload: one upload.
4. Sign out after a crash and sign in as another account: no recovery of the first account's audio.
5. With the local fault switch: a reported gap makes that answer "Not assessed · Part of this answer was not
   transcribed" in playback, with the estimate and recording note, while the next answer is graded normally.
