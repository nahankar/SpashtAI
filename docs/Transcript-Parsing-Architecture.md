# Transcript Parsing Architecture — Decision Record

Date: March 23, 2026
Status: Phase 1 implemented; Phase 2-3 planned

---

## Context

SpashtAI Replay accepts meeting transcripts in various forms: uploaded files (SRT, VTT, JSON), pasted text from meeting tools (Teams, Zoom, Google Meet), and eventually audio files transcribed via AWS Transcribe.

Each meeting tool produces transcripts in its own format, and even within a single tool the format varies by:
- **Delivery method** — copy-paste from UI vs. downloaded file vs. API export
- **Tool version** — formats change across releases
- **Platform quirks** — Teams paste includes permission notices, timestamps, `@1` prefixes; Zoom paste has different speaker/timestamp structure

Building a hand-coded parser for every variant is unsustainable.

---

## Problem Discovered (March 23, 2026)

A real Teams meeting transcript was pasted into Replay. The existing `parsePlainText` parser:
- Misread timestamp lines `0:03`, `42:18` as speaker labels ("0", "42")
- Failed to recognize the Teams block structure (speaker name → duration → MM:SS → speech)
- Produced garbage speaker detection: `["Speaker", "0", "1", "41", "42", "43", "44"]`

Combined with the silent participant-fallback bug (see below), this caused the system to analyze the wrong speaker under the user's name — a critical trust/accuracy issue.

### Fixes Applied (Same Day)

1. **Teams/Meet transcript parser** added to `transcript-parser.ts`
   - Recognizes the 3-line speaker header pattern: `Name` → `X minutes Y seconds` → `M:SS`
   - Strips inline timestamp metadata (`@N X minutes Y seconds`, `SpeakerName X minutes Y seconds`)
   - Skips preamble noise (download notices, permission text, "AI-generated content" disclaimers)
   - Auto-detected via `isMeetingTranscriptFormat()` heuristic

2. **Strict participant validation** in `replay.ts`
   - If user provides `participantName` but it doesn't match any detected speaker → fail immediately
   - Return structured error with detected speaker list
   - No more silent fallback to dominant speaker when user explicitly named themselves

3. **Speaker selection UI** in frontend
   - When participant not found, shows all detected speakers as selectable buttons
   - User picks correct speaker → PATCH updates session → re-processes

---

## Approaches Evaluated for Future-Proofing

### Option A: Hand-Coded Parsers Per Format
- **Pros:** Deterministic, fast, free, no API cost
- **Cons:** Tightly coupled to tool-specific formats; breaks when tools update; unsustainable at scale
- **Verdict:** Good for structured formats (SRT/VTT/JSON), bad for unstructured paste

### Option B: 100% LLM-Based Parsing
Send raw transcript text to an LLM with the instruction: "Extract structured segments as `[{ speaker, text, timestamp? }]`."
- **Pros:** Format-agnostic, robust to noise/junk lines, handles any paste format, future-proof
- **Cons:**
  - **Cost:** Doubles Bedrock spend (parsing call + analysis call)
  - **Latency:** Adds 5-15 seconds for parsing alone
  - **Token limits:** Long transcripts (100KB+) may exceed context windows, requiring chunking
  - **Non-deterministic:** Same input may produce slightly different segment boundaries
  - **Hallucination risk:** LLM could merge, split, or misattribute segments
- **Verdict:** Wrong as a universal approach, right for unstructured fallback

### Option C: Hybrid (Selected) ← RECOMMENDED
Tiered strategy combining deterministic parsing with LLM fallback:

| Tier | When | Method | Cost |
|------|------|--------|------|
| 1 | File has `.srt`/`.vtt`/`.json` extension | Deterministic parser | Free |
| 2 | Pasted text matches known pattern (Teams/Meet/Zoom) | Deterministic heuristic parser | Free |
| 3 | Unrecognized format or low-quality parse result | LLM extraction call | ~$0.002-0.01 |

```
Input arrives
  │
  ├─ Structured file (.srt/.vtt/.json)?
  │    └─ Deterministic parser (fast, free, reliable)
  │
  ├─ Pasted text or .txt/.docx?
  │    └─ Try deterministic heuristics
  │         ├─ Recognized → Deterministic parser
  │         └─ Unrecognized or poor quality → LLM extraction
  │              ├─ Use cheap/fast model (Nova Lite or Haiku-class)
  │              ├─ Include format templates as few-shot examples
  │              └─ Return structured [{ speaker, text, startTime? }]
  │
  └─ Validated segments → metrics + analysis pipeline
```

### Option D: Admin-Configurable Format Templates (Future Enhancement to Option C)
- Admins define example templates per tool via admin portal
- Templates injected as few-shot examples in the LLM parsing prompt
- New format support without code deploys
- **Verdict:** Right architecture long-term, premature now (insufficient format diversity)

---

## Architecture Principles

### 1. Parsing and Analysis Are Separate Steps
The transcript parsing call (Tier 3 LLM) produces structured data. The analysis call (Bedrock Nova Pro) consumes it. Never combine them — you need to validate parsed output before spending money on analysis.

### 2. Use Cheap Models for Parsing
Parsing is a structured extraction task, not a reasoning task. A small, fast model (Nova Lite, Haiku-class) is sufficient and costs 5-10x less than Nova Pro.

### 3. Cache Parsed Results
Store structured segments in the database after first parse. Re-processing (e.g., after speaker selection retry) should reuse cached segments, not re-parse.

### 4. Quality Gate Before Analysis
After parsing, validate the result:
- Speaker count > 0
- No single-character speaker names (indicates parser confusion)
- Segments contain actual text, not just metadata
If quality is low, route to Tier 3 (LLM) even if a deterministic parser ran.

### 5. LLM Should Never Guess Identity
The LLM parsing call extracts structure. Speaker identification is always either:
- Matched against user input (participantName)
- Presented for manual selection
The LLM analysis call receives a resolved speaker, never "figure out who this user is."

---

## Implementation Phases

### Phase 1 — DONE (March 23, 2026)
- Deterministic parsers: SRT, VTT, JSON, Teams/Meet paste, generic plain text
- Auto-detection via `detectFormatAndParse()`
- Quality sufficient for current user base (uploaded transcripts + Teams paste)

### Phase 2 — NEXT
- LLM-based fallback for unrecognized formats
  - Triggered when deterministic parsers produce low-quality output
  - Few-shot prompt with 3-4 example formats (Teams, Zoom, Otter, generic)
  - Cheap model (Nova Lite)
- Cache parsed segments in `ReplayResult.structuredTranscript`
- Add quality-gate scoring for parse results

### Phase 3 — FUTURE
- Admin template UI: CRUD for format examples
- Templates stored in DB, injected into LLM parsing prompt
- No deploy needed for new format support
- Trigger: when 5+ distinct formats need support and users report parsing failures

---

## Transcript Formats Reference

### Currently Supported (Deterministic)

| Format | Source | Detection Method |
|--------|--------|-----------------|
| SRT | Downloaded subtitle files | `.srt` extension or numbered-block pattern |
| VTT | Downloaded subtitle files | `.vtt` extension or `WEBVTT` header |
| JSON | API exports, SpashtAI internal | `.json` extension or `{`/`[` start |
| Teams/Meet paste | Copy-paste from meeting UI | 3-line header: name → `X minutes Y seconds` → `M:SS` |
| Generic `Speaker: text` | Manual transcripts | Fallback for unrecognized plain text |

### Known Formats Not Yet Supported

| Format | Source | Notes |
|--------|--------|-------|
| Zoom downloaded `.vtt` | Zoom cloud recordings | Likely works with existing VTT parser; needs testing |
| Zoom paste | Zoom meeting chat/transcript UI | Unknown structure; needs sample |
| Otter.ai export | Otter transcription service | Usually `.txt` with `Speaker Name  HH:MM` format |
| Fireflies.ai export | Fireflies | JSON or text; needs sample |
| Google Meet downloaded | Google Meet recordings | `.sbv` or `.srt` format |
| `.docx` transcripts | Various | Requires docx-to-text extraction first |

---

## Related Documents

- [Speaker Identification Brainstorming](./Speaker-Identification-Brainstorming.md) — covers participant identification strategy (name matching, voice enrollment, etc.)
- This document covers **transcript parsing** (extracting structured segments from raw input)
