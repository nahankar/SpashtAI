# DRAFT for review — Interviews recording, transcription, AI evaluation, storage and deletion

**Status: not published.** The live Terms and Privacy Policy are Admin-managed `LegalDocument` rows (both last
updated 2026-06-23 in production). Nothing here changes them. Publishing is an Admin action after review.

## 1. What the published documents say today (production, reviewed 26 Oct 2026)

- Terms §4 "Voice sessions and recordings" covers **Elevate and Replay only**; it grants a licence to process
  content "to provide the Service, improve our models and features (where permitted), and maintain session
  history". **Interviews is not mentioned.** "Improve our models" is not something Interviews content is used for
  today and should not be implied for it.
- Privacy §1 "Session data" and §3 "AI processing" cover Elevate/Replay coaching. **No mention** of Interviews,
  technical (subject-knowledge) evaluation, the 24-hour auto-completion of unfinished practice, or per-practice
  deletion. §7 Retention is generic ("while your account is active").
- Neither document names AWS. The code uses Amazon Transcribe (speech recognition), Amazon Polly (interviewer
  voice) and Amazon Bedrock (technical evaluation, coaching).

## 2. Signup routes reviewed

| Route | What happens today | Finding |
| --- | --- | --- |
| Email signup `POST /api/auth/register` | Requires `acceptedTerms: true` | The acceptance is **not stored** (no version or timestamp). |
| Google signup `POST /api/auth/google` + `/auth/complete-profile` | "By continuing / By signing up you agree…" text only | **No acceptance captured at all.** |
| Admin login | Not a signup | — |

Interviews has used a **per-practice checkbox** ("I agree to my answers being recorded and transcribed…"),
stored per run as `recordingConsentAt` + `recordingConsentVersion = interview-recording-1`.

## 3. One-time Interviews acknowledgment (implemented on the branch, text pending this review)

Shown once before a learner's first practice (every signup path reaches it the same way) and again only when the
version changes. Stored server-side as an append-only `RecordingAcknowledgment` row: version
`interview-recording-ai-1`, scope (`interview-audio-recording`, `speech-transcription`, `ai-technical-evaluation`,
`storage-and-deletion`), SHA-256 of the exact text shown, source, and acceptance time. Existing accounts are
**not** given an acknowledgment; they see the same one-time card. Each new practice records
`recordingConsentSource` (`ACCOUNT_ACKNOWLEDGMENT` or `PRACTICE_CHECKBOX`) and the acknowledgment id, and the
database refuses a run that claims an acknowledgment the owner does not have. If the acknowledgment status cannot
be loaded, the per-practice checkbox remains the gate.

**Exact text (draft):**

> Interview practice records your microphone audio during each practice and transcribes it automatically (Amazon
> Transcribe). Your saved answers may be evaluated by AI (Amazon Bedrock) to give technical feedback; this
> feedback is experimental and can be wrong. Recordings, transcripts and feedback are stored with your account so
> you can review them, and an unfinished practice is completed automatically after 24 hours without activity. You
> can delete any practice, with its recording, transcript and feedback, from Interview history at any time. Do
> not share confidential company or personal information in your answers.

Button: **I agree**. Reminder near Start afterwards: "Recording: your answers are recorded, transcribed and may be
evaluated by AI, as you agreed on {date}. You can delete any practice from Interview history."

Decisions for review: whether to name the providers; whether "experimental" stays while grading is not accepted;
whether to state a model-training position for Interviews (see §4).

## 4. Proposed Terms changes (exact wording, draft)

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

## 5. Proposed Privacy changes (exact wording, draft)

§1 add: "**Interview data:** audio recordings of your interview practice, automatic transcripts, your saved
answers, the questions asked, practice settings, and technical feedback generated from your answers."

§3 add: "In Interviews, your audio is transcribed by Amazon Transcribe and your saved answers may be evaluated by
AI models on Amazon Bedrock to produce technical feedback. This feedback is experimental. Interviews is separate
from Progress Pulse."

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
