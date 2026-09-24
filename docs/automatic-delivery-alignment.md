# Automatic delivery alignment

Completed Elevate sessions now queue word alignment without the user's manual
Reprocess permission. Leave, committed late turns, and successful browser upload
retries wake the durable queue. The minute sweep processes one session per tick.
One database lease limits automatic alignment to one session across API replicas;
the existing manual Reprocess pipeline is separate. Jobs have
a 15-minute subprocess deadline, a 20-minute lease, exponential retry delay and
five attempts before an explicit unavailable state. New inputs wake unavailable
jobs. API restarts recover expired processing jobs.

Deploy the Prisma migration before starting the updated API. The migration does
not queue existing sessions in bulk. An explicit Reprocess request also queues
an old session. `AUTO_DELIVERY_ALIGNMENT_ENABLED=false` pauses new worker runs;
the default is enabled. The worker requires the agent Python environment,
ffmpeg, and Gentle reachable via `GENTLE_URL` (default localhost:8765).
The existing Gentle service can be started with
`docker compose -f infra/gentle/docker-compose.yml up -d gentle`.

This is a dedicated alignment pass. It does not run the content analyser, LLM
coaching or manual reprocess pipeline. It stores words in a separate result,
with audio, transcript and Replay-timeline signatures. Complete browser user
recordings are required; composite audio is rejected. Each segment is aligned
separately and Gentle character offsets assign words to committed turn IDs.
Every accepted turn requires complete matching words, finite ordered times and
segment containment. A missing word suppresses that turn rather than inventing
a timestamp. Changed input and discarded-session results cannot be committed.
Before alignment and again under the commit lock, committed user words must
match the full saved user transcript. Different turn boundaries are allowed,
but missing or changed content keeps the job waiting. A late transcript update
wakes the queue and invalidates the previous alignment; identical retries do not.

Replay and Delivery Moments overlay current validated results on the original
turns. Pace uses the elapsed span from first word to last word of each accepted
turn, including pauses within that turn, excluding coach/inter-turn gaps. It
retains the existing minimum turn, duration, word and coverage requirements.
Missing/partial evidence cannot become a headline score. Late input invalidates
alignment-derived pace until reconciliation. Acoustic interpretations remain
experimental and the existing Delivery Moments feature flag still controls them.
The worker and subsequent analytics requests share the canonical pace resolver,
using the same accepted samples for rate and variability. Analytics rereads the
alignment under the session lock so a job completing during analysis is retained.

Results show background progress independently of manual Reprocess access.
Completion offers “View updated results” without interrupting current playback.
Polling stops after 20 minutes; the server continues independently.
When retries are exhausted, missing audio or transcript evidence is reported as
unavailable consistently in both the progress banner and Delivery Moments.

## Acceptance before release

1. Apply the migration to the test database and start API, agent signal API and
   Gentle. Record a new session with three substantive responses and a pause/resume.
2. Leave and switch result tabs while alignment runs. Verify pending then completed
   status, accepted words attached to their original turn IDs, and no duplicate job.
3. Refresh results. Verify weighted pace against accepted first/last-word spans;
   play a delivery moment on the second segment and verify the exact recording
   offset and audible pause with Skip gaps enabled.
4. Stop Gentle for a new session; verify durable retry and eventual unavailable
   copy. Restart API during a job; verify recovery after lease expiry.
5. Test a delayed upload, changed transcript, and discard during alignment. No
   stale or discarded result should be served or committed.

Automated tests validate the mapping, job lifecycle and API handoff using test
alignment output. They do not establish real-world alignment accuracy or coaching
calibration. Human-labelled holdout evaluation remains an independent requirement.
