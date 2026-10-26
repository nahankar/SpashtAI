# Interviews recording, transcription, AI evaluation, storage and deletion — policy wording

**Status: wording approved 26 Oct 2026, then revised 27 Oct 2026 at the user's request to remove provider names
from learner-facing text; not yet published.** The live Terms and Privacy Policy are Admin-managed
`LegalDocument` rows (both last updated 2026-06-23 in production). Nothing here changes them; publishing §4–§5 is
a separate Admin action. Learner-facing wording says "speech recognition", "automatic transcription" and "AI
technical feedback" and discloses that third-party cloud service providers process this content; the specific
services stay in internal configuration and technical documentation (below and in §1). Feedback is described as
experimental, and the model-training sentence in §4 is **not** adopted unless it is confirmed true for every
provider and contract. Only the Privacy §3 sentence and the acknowledgment text changed in the revision.

## 1. What the published documents say today (production, reviewed 26 Oct 2026)

- Terms §4 "Voice sessions and recordings" covers **Elevate and Replay only**; it grants a licence to process
  content "to provide the Service, improve our models and features (where permitted), and maintain session
  history". **Interviews is not mentioned.** "Improve our models" is not something Interviews content is used for
  today and should not be implied for it.
- Privacy §1 "Session data" and §3 "AI processing" cover Elevate/Replay coaching. **No mention** of Interviews,
  technical (subject-knowledge) evaluation, the 24-hour auto-completion of unfinished practice, or per-practice
  deletion. §7 Retention is generic ("while your account is active").
- Neither document names AWS. Internally (not in learner-facing text) the code uses Amazon Transcribe (speech
  recognition), Amazon Polly (interviewer voice) and Amazon Bedrock (technical evaluation, coaching).

## 2. Signup routes reviewed

| Route | What happens today | Finding |
| --- | --- | --- |
| Email signup `POST /api/auth/register` | Requires `acceptedTerms: true` | The acceptance is **not stored** (no version or timestamp). |
| Google signup `POST /api/auth/google` + `/auth/complete-profile` | "By continuing / By signing up you agree…" text only | **No acceptance captured at all.** |
| Admin login | Not a signup | — |

Interviews has used a **per-practice checkbox** ("I agree to my answers being recorded and transcribed…"),
stored per run as `recordingConsentAt` + `recordingConsentVersion = interview-recording-1`.

## 3. One-time Interviews acknowledgment (implemented on the branch, text approved)

Shown once before a learner's first practice (every signup path reaches it the same way) and again only when the
version changes. Stored server-side as an append-only `RecordingAcknowledgment` row: version
(current `interview-recording-ai-2`), scope (`interview-audio-recording`, `speech-transcription`, `ai-technical-evaluation`,
`storage-and-deletion`), SHA-256 of the exact text shown, source, and acceptance time. Existing accounts are
**not** given an acknowledgment; they see the same one-time card. Each new practice records
`recordingConsentSource` (`ACCOUNT_ACKNOWLEDGMENT` or `PRACTICE_CHECKBOX`) and the acknowledgment id, and the
database refuses a run that claims an acknowledgment the owner does not have. If the acknowledgment status cannot
be loaded, the per-practice checkbox remains the gate.

**Exact text, version `interview-recording-ai-2` (current):**

> Interview practice records your microphone audio during each practice and converts it to text with automatic
> speech recognition. Your saved answers may be evaluated by AI to give technical feedback; AI technical feedback
> is experimental and can be wrong. Speech recognition and AI technical feedback run on third-party cloud services
> that process this content on our behalf. Recordings, transcripts and feedback are stored with your account so
> you can review them, and an unfinished practice is completed automatically after 24 hours without activity. You
> can delete any practice, with its recording, transcript and feedback, from Interview history at any time. Do
> not share confidential company or personal information in your answers.

Version `interview-recording-ai-1` (approved 26 Oct 2026, named Amazon Transcribe and Amazon Bedrock) is kept
verbatim in `RECORDING_ACKNOWLEDGMENT_VERSIONS` so any acceptance of it stays verifiable by its stored text hash.
Such an acceptance is never rewritten; it no longer authorises new practices, so the learner sees the card once
more for the new version. Practices already started under it remain valid. The database accepts a run's consent
version only if it is the legacy checkbox version or a version the owner has an acceptance row for
(migration `20261027120000_recording_acknowledgment_versions`).

Button: **I agree**. After acceptance nothing is repeated near Start (removed at the user's request, 26 Oct
2026); the acceptance stays on record and each practice records its consent source.

Approved: "experimental" stays while grading is not accepted; no model-training
statement unless confirmed (see §4).

## 4. Terms changes (exact wording, approved; unchanged by the revision; not published)

Replace §4 heading and first paragraph with:

> **4. Voice sessions, interviews and recordings**
> When you use Elevate, Interviews or upload content to Replay, you may transmit audio, transcripts and related
> data. We process this content to provide the Service, including speech recognition, coaching and, for
> Interviews, AI evaluation of the technical content of your saved answers. Interview practice is recorded only
> after you acknowledge the Interviews recording notice. You can delete an interview practice, with its
> recording, transcript and feedback, at any time from Interview history. Do not upload or say anything you do not
> have the right to share.

Open decision: the existing phrase "improve our models and features (where permitted)". Proposed: keep it for
Elevate/Replay only if that is current practice, and add "Interview recordings, transcripts and technical feedback
are not used to train AI models." **Only adopt this sentence if it is true for every provider and contract.**

Add to §3: "Technical feedback in Interviews is generated automatically, is experimental and may be inaccurate."

## 5. Privacy changes (exact wording; §3 revised 27 Oct; not published)

§1 add: "**Interview data:** audio recordings of your interview practice, automatic transcripts, your saved
answers, the questions asked, practice settings, and technical feedback generated from your answers."

§3 add (revised 27 Oct): "In Interviews, your audio is converted to text by automatic speech recognition, and your
saved answers may be evaluated by AI models to produce AI technical feedback. These services are provided by
third-party cloud service providers that process this content on our behalf, as described in Section 5. AI
technical feedback is experimental. Interviews is separate from Progress Pulse."

§7 add: "**Interviews:** recordings, transcripts and feedback are kept with your account until you delete the
practice or your account. An unfinished practice is completed automatically after 24 hours without activity.
Deleting a practice removes its recording, transcript, answers and feedback; usage records needed for billing and
security are kept without the content."

§4 add: "For Interviews recording and AI processing we rely on your acknowledgment, recorded with its version and
time, and you may stop using Interviews or delete practices at any time."

## 6. Proposed onboarding changes (not implemented; need a decision)

1. Store Terms/Privacy acceptance with document versions and timestamp at email signup (today the checkbox is
   checked but not stored) and at Google signup completion (today none is captured).
2. Add an explicit Terms/Privacy checkbox to Google `complete-profile`, mirroring email signup.
3. When the published Terms/Privacy change materially, prompt existing users once and store that acceptance;
   do not create acceptance records for anyone who has not accepted.

## 7. Release step: publish with this branch (authorised 26 Oct 2026)

The user asked for the approved §4–§5 additions to be published **when this branch is released**, not before.
The full revised documents are ready in `docs/prepare/legal/terms.txt` and `docs/prepare/legal/privacy.txt`.
They are the production text of 2026-06-23 with only the approved additions applied (§4 heading and paragraph,
a sentence added to Terms §3, and Privacy §1, §3, §4 and §7). Every other line is unchanged.

At release, after the deploy has passed its checks:

1. Read the live documents (`GET /api/legal/terms`, `GET /api/legal/privacy`). Confirm each `content` still
   has SHA-256 `25b309b8…909b9a` (terms) or `c9850edf…180fb0b` (privacy), the 2026-06-23 baseline. If either
   differs, someone has edited it since review: stop and re-apply the additions to the current text for approval.
2. Replace `{RELEASE_DATE}` with the release date (YYYY-MM-DD).
3. Publish through the Admin legal editor (`PUT /api/admin/legal/:slug`, Admin), keeping the titles
   "Terms and Conditions" and "Privacy Policy".
4. Confirm both public pages show the new text and date, and record the publish in the release report.

Do not publish if the release does not include the acknowledgment (`interview-recording-ai-1`), because the
new text says recording happens only after that acknowledgment.

Full baseline hashes: terms `25b309b87e82d5fbdfac1bfdbd7f90fa65331d3436c97bea37a80d4a35909b9a`, privacy
`c9850edf01e27666f29f55272e897d170c1171569827eae3545f411f4180fb0b`.
