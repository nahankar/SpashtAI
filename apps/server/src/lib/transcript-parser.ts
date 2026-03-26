export interface TranscriptSegment {
  speaker: string
  text: string
  startTime?: number
  endTime?: number
}

export interface ParsedTranscript {
  segments: TranscriptSegment[]
  fullText: string
  speakerCount: number
}

export function parseSRT(content: string): ParsedTranscript {
  const blocks = content.trim().split(/\n\n+/)
  const segments: TranscriptSegment[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length < 3) continue

    const timeLine = lines[1]
    const text = lines.slice(2).join(' ').trim()
    if (!text) continue

    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    )

    let startTime: number | undefined
    let endTime: number | undefined
    if (timeMatch) {
      startTime =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000
      endTime =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000
    }

    const speakerMatch = text.match(/^<?([^>:]+?)>?:\s*(.+)/)
    const speaker = speakerMatch ? speakerMatch[1].trim() : 'Speaker'
    const cleanText = speakerMatch ? speakerMatch[2].trim() : text

    segments.push({ speaker, text: cleanText, startTime, endTime })
  }

  return finalize(segments)
}

export function parseVTT(content: string): ParsedTranscript {
  const lines = content.split('\n')
  const segments: TranscriptSegment[] = []
  let i = 0

  // Skip WEBVTT header
  while (i < lines.length && !lines[i].includes('-->')) i++

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line.includes('-->')) {
      i++
      continue
    }

    const timeMatch = line.match(
      /(\d{2}):(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.](\d{3})/
    )
    let startTime: number | undefined
    let endTime: number | undefined
    if (timeMatch) {
      startTime =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000
      endTime =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000
    }

    i++
    const textLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
      textLines.push(lines[i].trim())
      i++
    }

    const text = textLines.join(' ')
    if (!text) continue

    const { speaker, text: cleanText } = extractSpeakerFromVTTText(text)
    segments.push({ speaker, text: cleanText, startTime, endTime })
  }

  return finalize(segments)
}

function extractSpeakerFromVTTText(raw: string): { speaker: string; text: string } {
  // WebVTT voice span: <v Speaker Name>text here</v>
  const voiceMatch = raw.match(/^<v\s+([^>]+)>(.+)$/s)
  if (voiceMatch) {
    const speaker = voiceMatch[1].trim()
    const text = voiceMatch[2].replace(/<\/v>/g, '').trim()
    return { speaker, text }
  }

  // Standard "Speaker: text" or "<Speaker>: text"
  const colonMatch = raw.match(/^<?([^>:]+?)>?:\s*(.+)/s)
  if (colonMatch) {
    return { speaker: colonMatch[1].trim(), text: colonMatch[2].trim() }
  }

  return { speaker: 'Speaker', text: raw }
}

/** Lines before the first subtitle cue (no `-->`), for metadata scanning. */
function transcriptHeaderLinesBeforeFirstCue(content: string, maxLines = 80): string[] {
  const lines = content.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/-->/.test(t)) break
    if (out.length >= maxLines) break
    out.push(t)
  }
  return out
}

function utcNoonDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt
}

/**
 * Try to infer calendar meeting date from VTT/SRT-style transcript text and/or original filename.
 * Cue timestamps (00:00:01 -->) are relative to the recording — they are not used here.
 * Supports: Zoom-style filenames (GMT20240315-...), ISO dates in headers/NOTE lines, common "Date:" prefixes.
 */
export function extractMeetingDateFromTranscript(content: string, originalFileName?: string): Date | null {
  const tryYmd = (y: string, mo: string, da: string): Date | null => {
    const yi = parseInt(y, 10)
    const mi = parseInt(mo, 10)
    const di = parseInt(da, 10)
    if (yi < 1990 || yi > 2100) return null
    return utcNoonDate(yi, mi, di)
  }

  const name = originalFileName || ''

  // Zoom recording: GMT20240315-120000
  const zoomGmt = name.match(/GMT(\d{4})(\d{2})(\d{2})/i)
  if (zoomGmt) {
    const d = tryYmd(zoomGmt[1], zoomGmt[2], zoomGmt[3])
    if (d) return d
  }

  // Filename: 2024-03-15 or 20240315 (word boundary)
  const isoInName = name.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (isoInName) {
    const d = tryYmd(isoInName[1], isoInName[2], isoInName[3])
    if (d) return d
  }
  const compactInName = name.match(/\b(20\d{2})(\d{2})(\d{2})\b/)
  if (compactInName && compactInName[0].length === 8) {
    const d = tryYmd(compactInName[1], compactInName[2], compactInName[3])
    if (d) return d
  }

  const trimmed = content.trim()
  if (!trimmed) return null

  const header =
    trimmed.startsWith('WEBVTT') || trimmed.includes('-->')
      ? transcriptHeaderLinesBeforeFirstCue(trimmed)
      : trimmed.split('\n').slice(0, 40).map((l) => l.trim()).filter(Boolean)

  const headerText = header.join('\n')

  // ISO dates in header / NOTE blocks
  const isoGlobal = headerText.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)
  if (isoGlobal?.length) {
    for (const iso of isoGlobal) {
      const p = iso.match(/^(20\d{2})-(\d{2})-(\d{2})$/)
      if (p) {
        const d = tryYmd(p[1], p[2], p[3])
        if (d) return d
      }
    }
  }

  // "Date:" or "Meeting date:" lines (case-insensitive)
  const dateLine = headerText.match(
    /(?:date|meeting\s*date|recorded\s*(?:on|at))\s*[:]\s*(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})/i
  )
  if (dateLine) {
    const v = dateLine[1].trim()
    const iso = v.match(/^(20\d{2})-(\d{2})-(\d{2})$/)
    if (iso) {
      const d = tryYmd(iso[1], iso[2], iso[3])
      if (d) return d
    }
    const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/)
    if (us) {
      const d = tryYmd(us[3], us[1], us[2])
      if (d) return d
    }
  }

  return null
}

export function parseJSON(content: string): ParsedTranscript {
  const data = JSON.parse(content)

  // SpashtAI format: { messages: [{ role, content, timestamp }] }
  if (Array.isArray(data.messages)) {
    const segments: TranscriptSegment[] = data.messages.map((m: any) => ({
      speaker: m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : (m.speaker || 'Speaker'),
      text: m.content || m.text || '',
    }))
    return finalize(segments)
  }

  // Generic array of turns
  if (Array.isArray(data)) {
    const segments: TranscriptSegment[] = data.map((t: any) => ({
      speaker: t.speaker || t.role || 'Speaker',
      text: t.text || t.content || '',
      startTime: t.startTime ?? t.start_time,
      endTime: t.endTime ?? t.end_time,
    }))
    return finalize(segments)
  }

  // { conversation: [...] } or { turns: [...] }
  const arr = data.conversation || data.turns || data.segments || []
  const segments: TranscriptSegment[] = arr.map((t: any) => ({
    speaker: t.speaker || t.role || 'Speaker',
    text: t.text || t.content || '',
    startTime: t.startTime ?? t.start_time,
    endTime: t.endTime ?? t.end_time,
  }))
  return finalize(segments)
}

// ── Meeting transcript format (Teams / Google Meet paste) ──
// Pattern per speaker block:
//   SpeakerName              ← name on own line
//   X minutes Y seconds      ← duration line
//   M:SS                     ← short timestamp
//   @1 X minutes Y seconds   ← inline timestamp (may repeat)
//   Actual speech text...

const DURATION_RE = /^(\d+)\s+minutes?\s+(\d+)\s+seconds?$/i
const SHORT_TS_RE = /^(\d{1,2}):(\d{2})$/
const ENDS_WITH_TS_RE = /\d+\s+minutes?\s+\d+\s+seconds?\s*$/i

function isSpeakerHeader(lines: string[], idx: number): boolean {
  if (idx + 2 >= lines.length) return false
  const name = lines[idx]?.trim()
  if (!name || !/[A-Za-z]/.test(name)) return false
  if (DURATION_RE.test(name) || SHORT_TS_RE.test(name)) return false
  if (name.startsWith('@')) return false
  return (
    DURATION_RE.test(lines[idx + 1]?.trim()) &&
    SHORT_TS_RE.test(lines[idx + 2]?.trim())
  )
}

function parseShortTs(line: string): number {
  const m = line.trim().match(SHORT_TS_RE)
  if (!m) return 0
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

export function isMeetingTranscriptFormat(content: string): boolean {
  const lines = content.split('\n')
  let matches = 0
  const limit = Math.min(lines.length - 2, 120)
  for (let i = 0; i < limit; i++) {
    if (isSpeakerHeader(lines, i)) {
      matches++
      if (matches >= 2) return true
      i += 2
    }
  }
  return false
}

export function parseMeetingTranscript(content: string): ParsedTranscript {
  const lines = content.split('\n')
  const segments: TranscriptSegment[] = []

  let i = 0
  while (i < lines.length) {
    if (isSpeakerHeader(lines, i)) {
      const speaker = lines[i].trim()
      const startTime = parseShortTs(lines[i + 2])
      i += 3

      const textParts: string[] = []
      while (i < lines.length && !isSpeakerHeader(lines, i)) {
        const line = lines[i].trim()
        i++

        if (!line) continue
        if (DURATION_RE.test(line)) continue
        if (SHORT_TS_RE.test(line)) continue
        if (ENDS_WITH_TS_RE.test(line)) continue

        textParts.push(line)
      }

      const text = textParts.join(' ').trim()
      if (text) {
        segments.push({ speaker, text, startTime })
      }
    } else {
      i++
    }
  }

  return finalize(segments)
}

// ── Teams docx transcript (extracted text) ──
// Pattern: "SpeakerName  M:SS" on one line, speech text on following lines
// Also contains "started/stopped transcription" events and a header block.

const DOCX_SPEAKER_RE = /^(.+?)\s{2,}(\d{1,2}:\d{2})\s*$/
const TRANSCRIPT_EVENT_RE = /\b(started|stopped|joined|left)\s+(transcription|the meeting)\b/i

export function isTeamsDocxFormat(content: string): boolean {
  const lines = content.split('\n')
  let matches = 0
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (DOCX_SPEAKER_RE.test(lines[i]?.trim())) {
      matches++
      if (matches >= 2) return true
    }
  }
  return matches >= 1 && /^Transcript\b/im.test(content)
}

export function parseTeamsDocx(content: string): ParsedTranscript {
  const lines = content.split('\n')
  const segments: TranscriptSegment[] = []

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // Check for speaker header: "Name  M:SS"
    const headerMatch = trimmed.match(DOCX_SPEAKER_RE)
    if (headerMatch) {
      const speaker = headerMatch[1].trim()
      const tsParts = headerMatch[2].split(':')
      const startTime = parseInt(tsParts[0]) * 60 + parseInt(tsParts[1])
      i++

      const textParts: string[] = []
      while (i < lines.length) {
        const next = lines[i].trim()
        // Stop at next speaker header, event line, or double blank
        if (DOCX_SPEAKER_RE.test(next)) break
        if (TRANSCRIPT_EVENT_RE.test(next)) break
        if (!next) { i++; continue }
        textParts.push(next)
        i++
      }

      const text = textParts.join(' ').trim()
      if (text) {
        segments.push({ speaker, text, startTime })
      }
    } else {
      i++
    }
  }

  return finalize(segments)
}

// ── Generic plain-text parser (fallback) ──

export function parsePlainText(content: string): ParsedTranscript {
  const lines = content.split('\n').filter((l) => l.trim())
  const segments: TranscriptSegment[] = []
  let currentSpeaker = 'Speaker'

  for (const line of lines) {
    const trimmed = line.trim()

    // "Speaker:" on its own line (label only, text follows on next lines)
    const labelOnly = trimmed.match(/^\[?([A-Za-z0-9 _-]+?)\]?\s*:\s*$/)
    if (labelOnly) {
      currentSpeaker = labelOnly[1].trim()
      continue
    }

    // "Speaker: some text" on the same line
    const speakerMatch = trimmed.match(
      /^\[?([A-Za-z0-9 _-]+?)\]?\s*:\s*(.+)/
    )
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].trim()
      segments.push({
        speaker: currentSpeaker,
        text: speakerMatch[2].trim(),
      })
    } else {
      segments.push({ speaker: currentSpeaker, text: trimmed })
    }
  }

  return finalize(segments)
}

function mergeConsecutiveSpeakerSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= 1) return segments

  const merged: TranscriptSegment[] = []
  let current = { ...segments[0] }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const gap =
      seg.startTime !== undefined && current.endTime !== undefined
        ? seg.startTime - current.endTime
        : 0
    if (seg.speaker === current.speaker && gap < 2) {
      current.text += ' ' + seg.text
      if (seg.endTime !== undefined) current.endTime = seg.endTime
    } else {
      merged.push(current)
      current = { ...seg }
    }
  }
  merged.push(current)

  return merged
}

function finalize(segments: TranscriptSegment[]): ParsedTranscript {
  const merged = mergeConsecutiveSpeakerSegments(segments)
  const speakers = new Set(merged.map((s) => s.speaker))
  return {
    segments: merged,
    fullText: merged.map((s) => s.text).join(' '),
    speakerCount: speakers.size || 1,
  }
}

/**
 * Build a speaker-labeled transcript string for AI analysis.
 * Format: "[Speaker Name]: text here" — one block per merged segment.
 */
export function buildSpeakerLabeledText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n\n')
}

/**
 * Post-process AI-generated annotated transcript to correct speaker attribution.
 * Matches each annotated segment's text against the original parsed segments
 * and replaces the speaker with the correct one from the source data.
 */
export function correctAnnotatedSpeakers(
  annotations: { speaker: string; text: string; annotations?: string[] }[],
  segments: TranscriptSegment[]
): { speaker: string; text: string; annotations?: string[] }[] {
  if (!annotations?.length || !segments?.length) return annotations || []

  return annotations.map((ann) => {
    const correctedSpeaker = findSpeakerForText(ann.text, segments)
    return {
      ...ann,
      speaker: correctedSpeaker || ann.speaker,
    }
  })
}

function findSpeakerForText(annotatedText: string, segments: TranscriptSegment[]): string | null {
  if (!annotatedText) return null

  const normalized = annotatedText.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ')
  if (words.length < 3) return null

  // Try to find a significant substring (first 8+ words) in segment texts
  const searchPhrase = words.slice(0, Math.min(words.length, 12)).join(' ')

  let bestMatch: { speaker: string; score: number } | null = null

  for (const seg of segments) {
    const segNorm = seg.text.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim()

    if (segNorm.includes(searchPhrase)) {
      return seg.speaker
    }

    // Partial match: count shared words from the start
    const segWords = segNorm.split(' ')
    let matchCount = 0
    for (const w of words) {
      if (segWords.includes(w)) matchCount++
    }

    const score = matchCount / words.length
    if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { speaker: seg.speaker, score }
    }
  }

  return bestMatch?.speaker || null
}

/**
 * Filter annotated transcript to only include segments from the analyzed participant.
 * Uses fuzzy first-name matching to handle slight name variations.
 */
export function filterParticipantAnnotations(
  annotations: { speaker: string; text: string; annotations?: string[] }[],
  segments: TranscriptSegment[],
  participantName?: string
): { speaker: string; text: string; annotations?: string[] }[] {
  if (!participantName || !annotations?.length) return annotations || []

  const nameParts = participantName.toLowerCase().split(/\s+/)
  const firstName = nameParts[0]
  const lastName = nameParts[nameParts.length - 1]

  return annotations.filter((ann) => {
    const speaker = ann.speaker?.toLowerCase() || ''
    return speaker.includes(firstName) || speaker.includes(lastName)
  })
}

export function detectFormatAndParse(
  content: string,
  mimeType?: string,
  fileName?: string
): ParsedTranscript {
  const ext = fileName?.split('.').pop()?.toLowerCase()

  if (ext === 'srt' || mimeType?.includes('subrip')) return parseSRT(content)
  if (ext === 'vtt' || mimeType?.includes('vtt')) return parseVTT(content)
  if (ext === 'json' || mimeType?.includes('json')) return parseJSON(content)

  // Try JSON first, fall back to plain text
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJSON(content)
    } catch {
      // not valid JSON
    }
  }

  // Check for WEBVTT header
  if (trimmed.startsWith('WEBVTT')) return parseVTT(content)

  // Check for SRT-style numbered blocks
  if (/^\d+\r?\n\d{2}:\d{2}/.test(trimmed)) return parseSRT(content)

  // Teams / Google Meet transcript paste (browser copy)
  if (isMeetingTranscriptFormat(content)) return parseMeetingTranscript(content)

  // Teams docx transcript (extracted text)
  if (isTeamsDocxFormat(content)) return parseTeamsDocx(content)

  return parsePlainText(content)
}
