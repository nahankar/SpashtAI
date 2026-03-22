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

    const speakerMatch = text.match(/^<?([^>:]+?)>?:\s*(.+)/)
    const speaker = speakerMatch ? speakerMatch[1].trim() : 'Speaker'
    const cleanText = speakerMatch ? speakerMatch[2].trim() : text

    segments.push({ speaker, text: cleanText, startTime, endTime })
  }

  return finalize(segments)
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

function finalize(segments: TranscriptSegment[]): ParsedTranscript {
  const speakers = new Set(segments.map((s) => s.speaker))
  return {
    segments,
    fullText: segments.map((s) => s.text).join(' '),
    speakerCount: speakers.size || 1,
  }
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

  return parsePlainText(content)
}
