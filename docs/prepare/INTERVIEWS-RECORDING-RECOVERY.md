# Recording recovery after refresh or crash (D-1)

Shared by Interviews and Elevate (both use `SessionRecorder` and `useAudioRecording`). Code:
`apps/web/src/lib/recordingJournal.ts`, `apps/web/src/lib/recordingRecovery.ts`,
`apps/web/src/components/session/RecordingRecovery.tsx`.

## How it works

- The recorder already records WebM/Opus in 1-second timeslices (`MediaRecorder.start(1000)`). Each timeslice is
  also appended to a local IndexedDB journal as it arrives, keyed by **account, session, segment and recording id**,
  with the metadata needed for the upload (start time, capture settings, slice count, last write time).
- Concatenating a recording's slices in order (the first carries the WebM header) is the same file the normal
  upload sends; any in-order prefix is also playable. Verified in the browser: a journal from a page reloaded
  mid-recording was uploaded and the server decoded it (`audio/webm`, Opus 48 kHz, 15.24 s).
- After a reload or reconnect, the signed-in app uploads abandoned journals to their **original** session and
  segment through the normal upload endpoint (`POST /sessions/:id/recording/upload`), never to a new question or
  segment. It runs on load, when the browser comes back online, and every minute. That endpoint is idempotent per
  segment (the same payload returns 200; a different one is refused with 409).
- Recovery does not rely on an unload-time upload; the existing best-effort upload on unmount is unchanged.

## Concurrency and identity

- A live recorder holds a Web Lock on its journal key for its whole life; recovery takes the same lock with
  `ifAvailable`, so a recording still being written (in any tab) is never uploaded, and two tabs never upload the
  same recording (verified in the browser: the second recovery reported `locked`, one upload).
- Without Web Locks, a journal counts as abandoned only after 2 minutes without new slices.
- Only the signed-in account's journals are read for recovery, and the server re-checks ownership. Verified in the
  browser: account A's journal stayed untouched while B was signed in and was recovered when A signed in again.

## When local audio is deleted

| Event | Local copy |
| --- | --- |
| Normal upload confirmed by the server | deleted |
| Discard | deleted |
| Recovery upload confirmed | deleted |
| Server: practice deleted/discarded (404/410), segment already has its recording (409), nothing playable (400/413/422) | deleted |
| Network failure, timeout, 408/429/5xx (offline) | kept, retried later |
| 401/403 | kept (the owner may sign in again) |
| Explicit sign-out | bounded upload attempt (8 s, with the token captured before sign-out), then all of that account's local recordings are deleted, except a recording still live in another tab |
| Any account's entry older than 7 days | deleted |

Signing in as another account without signing out leaves the previous account's entries in this browser
(invisible to the app for the other account) until that account signs in again (recovered), signs out, or 7 days
pass.

## Limits (stated honestly)

- **Maximum unpersisted audio at a crash:** the current timeslice (about 1 s) plus one local write, so typically
  1–2 s. Zero loss at the instant of a crash is not possible.
- If IndexedDB is unavailable (some private modes), recording and upload work exactly as before, with no recovery.
  If storage fails or the quota is reached part-way, journaling stops, the stored prefix stays recoverable, and the
  in-memory recording and its normal upload are unaffected.
- A recovered recording has no duration header (same as today's uploads); the server measures decoded duration.

## Privacy wording review

The current acknowledgment (`interview-recording-ai-2`) says recordings are "stored with your account", and the
Privacy Policy §11 lists "essential cookies and local storage (e.g., authentication tokens, session preferences)".
Neither mentions that audio may be kept temporarily **in the browser** for recovery. Proposed additions, **not
applied** (a wording change needs approval, a new acknowledgment version and a Terms/Privacy republish):

- Acknowledgment: "If the page closes unexpectedly, your recording is kept temporarily in this browser and uploaded
  when you return. It is removed once uploaded, when you sign out, or after 7 days."
- Privacy §11: "…and, for voice practice, temporary recording recovery data kept in your browser until it is
  uploaded, you sign out, or 7 days pass."
