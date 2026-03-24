# Speaker Identification in SpashtAI Replay — Brainstorming & Decision Record

Date: March 2, 2026

## The Core Problem

SpashtAI Replay allows users to upload multi-speaker meeting recordings or paste transcripts for AI-powered communication coaching. The system must determine **which speaker in the conversation is the logged-in user** so it can focus its analysis and feedback on that individual.

This breaks down into two sub-problems:

1. **Diarization** — "who spoke when" — labeling segments of speech by speaker identity (Speaker 1, Speaker 2, etc.)
2. **Identification** — "which of those speakers is User X" — mapping a labeled speaker to the actual logged-in user

Diarization is a solved problem (AWS Transcribe handles it). Identification is the open challenge.

---

## Market Research

### Communication Coaching Tools (Direct Competitors)

| Tool | Upload Support | Speaker Selection | Notes |
|------|---------------|-------------------|-------|
| **TalkMeUp** | Yes (Zoom/Teams recordings) | No — analyzes presenter holistically | Closest to SpashtAI; does speaker + audience + conversation analysis but no "pick a participant" workflow |
| **Yoodli** | No | N/A | Live-only coaching, single-speaker |
| **Poised** | No | N/A | Live meeting coaching, analyzes all speakers in real-time |
| **Orai** | Self-recordings only | N/A | Individual speech practice, not multi-speaker |
| **Speeko** | Self-recordings only | N/A | Individual speech practice, not multi-speaker |

**Conclusion:** No direct competitor offers the ability to upload a multi-speaker recording and select which participant to focus coaching on. This is a gap in the market and a differentiator for SpashtAI.

### Meeting Intelligence Platforms (Adjacent)

| Tool | How They Identify Speakers |
|------|---------------------------|
| **OneScribe** | Speaker detection at 95% confidence, editable speaker names. Transcription tool, not coaching. |
| **Speaker Analytics** (speakeranalyzer.com) | Uploads VTT transcripts, per-speaker word count/talk time/speaking rate. Analytics only. |
| **Knowbase.ai** | Speaker identification + renaming, speaker-scoped queries. Knowledge base tool, not coaching. |
| **Gong / Chorus** | Calendar integration + CRM data + ML trained on millions of sales calls. Full platforms, not APIs. |
| **Fireflies.ai** | Name matching from intros + calendar context + user correction. Full platform. |
| **Otter.ai** | Voice enrollment (optional) + calendar integration + user correction. Full platform. |
| **Avoma** | Calendar participants + email domains + speaking patterns + corrections. |

**Conclusion:** These platforms solve identification through external context (calendar, CRM) or full-platform approaches. None offer a pluggable API for "given this transcript, which speaker is User X."

### Cloud Speech-to-Text Services

| Service | Diarization | Named Identification | Cost |
|---------|------------|---------------------|------|
| **AWS Transcribe** | Yes (spk_0, spk_1) | Yes, with voice enrollment (+$0.003/min) | $0.024/min |
| **AssemblyAI** | Yes (strong, accents-friendly) | Beta: NER-based name detection from transcript | $0.015/min |
| **Deepgram** | Yes (fast, 2-20 speakers) | Limited, with enrollment | $0.0125/min |
| **Google Cloud STT** | Yes (2-6 speakers) | No built-in identification | $0.024/min |
| **Azure Speech** | Yes | Separate Speaker Recognition API with enrollment | $1/1000 transactions |
| **Rev.ai** | Yes | Optional human labeling ($1.50/min) | $0.045/min (AI) |

### Voice Biometrics Platforms

| Platform | Approach | API Friendly | Notes |
|----------|----------|-------------|-------|
| **VoiceIt.io** | Voice enrollment (3 recordings x 10 seconds) + verification | Yes | 98%+ verification, 90%+ identification accuracy |
| **Pindrop** | Enterprise voiceprints | No — enterprise licensing | Used by banks |
| **Nuance Gatekeeper** | Passive enrollment from conversations | No — enterprise-only | Expensive |
| **SpeechPro** | Voice biometrics SDK | No — on-premise | Forensics/security |

---

## Approaches Evaluated

### 1. Manual Name Field (Selected for Phase 1)
- User types their name in the context form
- System does case-insensitive matching against speaker labels in the transcript
- **Accuracy:** 100% for named-speaker transcripts ("Neelesh:", "Sarah:")
- **Fails:** Generic labels ("Speaker 1", "spk_0")
- **Cost:** Zero
- **Infrastructure:** None

### 2. Speaker Selection UI with Sample Quotes (Planned for Phase 2)
- After transcription, show 2-3 sample quotes per detected speaker
- User clicks "This is me" on their speaker
- **Accuracy:** 100% (manual selection)
- **Works:** All cases including generic labels
- **Trade-off:** Adds a step between transcription and analysis; requires pausing the processing pipeline
- **Recommended by:** Claude Code analysis as "Phase 1 MVP"

### 3. Voice Enrollment + Matching (Deferred to Phase 3)
- User records 30-second voice sample during onboarding
- System creates voice embedding, matches against speakers in future uploads
- **Accuracy:** 90-95% with good quality audio
- **Providers:** AWS Transcribe Speaker Identification, VoiceIt.io, Azure Speaker Recognition
- **Trade-offs:**
  - Requires biometric storage (privacy/regulatory concerns)
  - Cold start problem (can't identify without enrollment)
  - Fails with poor quality audio or phone recordings
  - Additional ML infrastructure

### 4. LLM Role-Based Analysis (Evaluated, not selected)
- Feed role context ("I was the interviewer") + transcript to LLM
- LLM identifies which speaker matches the role based on conversation patterns
- **Accuracy:** 75-85%
- **Cost:** Extra Bedrock call (~$0.005/call), 5-10s latency
- **Fails:** Collaborative meetings where roles are ambiguous

### 5. Name Detection via NER (Evaluated, not selected)
- Parse transcript for introductions ("Hi, I'm Sarah from sales...")
- Match extracted names against user profile
- **Providers:** AWS Comprehend, AssemblyAI (beta), spaCy
- **Accuracy:** 85%+ when names are present
- **Fails:** Many meetings lack formal introductions

### 6. Dominant Speaker Heuristic (Evaluated, not selected)
- Assume user is the speaker with most talking time
- **Accuracy:** 60-70%
- **Fails completely:** Interviews (50/50 split), collaborative discussions
- **Useful only as:** Quick default suggestion, not final answer

### Trade-off Summary

| Method | Accuracy | Setup Effort | Cost | Works Without Audio | Privacy Risk |
|--------|----------|-------------|------|-------------------|-------------|
| Manual name field | 100% (named speakers) | None | Free | Yes | None |
| Speaker selection UI | 100% | None | Free | Yes | None |
| Voice enrollment | 90-95% | One-time 30s recording | Low | No | Biometric storage |
| LLM role analysis | 75-85% | None | ~$0.005/call | Yes | None |
| Name detection (NER) | 85%+ when names present | None | Low | Yes | None |
| Dominant speaker | 60-70% | None | Free | Yes | None |

---

## Key Insight

**No tool or API in the market offers "send a transcript + user ID, get back which speaker is the user."**

Every approach requires one of:
- **(a) Manual input** — user tells the system who they are
- **(b) Voice enrollment** — user records a sample in advance
- **(c) External context** — calendar integration, CRM data, or historical session data

This makes participant selection a genuine differentiator for SpashtAI's Replay feature. The combination of upload + select participant + receive focused coaching feedback does not exist in any competitor product today.

---

## Decision: Phased Approach

### Phase 1 — IMPLEMENTED (Updated March 23, 2026)
**Method:** Name field in the Context Form + strict validation + speaker selection fallback

- User types their name as it appears in the transcript
- Case-insensitive + partial matching in metrics calculation
- AI prompt injection to focus analysis on the named participant
- **CRITICAL FIX (March 23):** If participantName is provided but doesn't match any detected speaker, processing **fails immediately** with a structured error containing the detected speaker list — no silent fallback to dominant speaker
- Frontend shows a **speaker selection UI** with all detected speakers as clickable buttons
- User picks correct speaker → session is patched → re-processes automatically
- When participantName is blank, fallback to dominant speaker is still the correct default behavior

**Covers:** ~95%+ of current use cases (pasted transcripts with named speakers, plus recovery for generic labels like "Speaker 1")

**Related:** Transcript parsing quality directly affects speaker detection. See [Transcript Parsing Architecture](./Transcript-Parsing-Architecture.md) for the parsing strategy that ensures correct speaker extraction from various meeting tools.

### Phase 2 — PARTIALLY DONE (March 23, 2026)
**Method:** Speaker selection UI (implemented), sample quotes (future enhancement)

- **DONE:** When name doesn't match, detected speakers shown as selectable buttons
- **DONE:** PATCH endpoint to update participantName + re-process failed sessions
- **FUTURE:** Show 2-3 sample quotes per speaker to help user identify themselves (especially for generic labels like spk_0, spk_1 from AWS Transcribe)
- **FUTURE:** Pre-select if name field partially matches a speaker label

**Trigger for quotes enhancement:** When audio upload/transcription is used in production and users encounter generic speaker labels

### Phase 3 — FUTURE (If power users demand it)
**Method:** Optional voice enrollment

- "Enable Voice Recognition" toggle in user settings
- Record 30-second voice sample
- AWS Transcribe Speaker Identification or VoiceIt.io
- Auto-identify in future uploads with manual override always available
- Premium/opt-in feature

**Trigger to build:** Power users with 10+ uploads/month requesting automation; measurable churn from manual selection friction

---

## Rationale

1. Phase 1 covers the dominant use case with zero complexity
2. Phase 2 only becomes necessary when the audio upload path is fully operational
3. Phase 3 only justified by user volume and churn data
4. No existing market tool eliminates the need for Phase 1
5. The phased approach avoids over-engineering while preserving a clear upgrade path
