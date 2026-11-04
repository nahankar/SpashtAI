import { rmsDbfs, type Pcm } from './pcm.js'

export interface Recognizer { transcribe(pcm: Pcm, signal?: AbortSignal): Promise<string> }

export interface RecognitionPart { startMs: number; endMs: number; text: string }

export interface WindowOptions {
  /** Longest window sent to the recognizer in one request. */
  maxMs?: number
  /** Do not split before this point of a window (avoids tiny fragments). */
  minMs?: number
  thresholdDb?: number
}

/**
 * Long utterances are recognized in windows of at most `maxMs`, split at the quietest pause.
 *
 * Why: run 20261104-063150-035fe5 sent one 21.7 s utterance to the local Whisper model, which deterministically
 * dropped its final sentences ("… Here's your topic. Let's see." instead of "… Here's your topic: blockchain
 * technology. Let's see how you do."), while ≤ 12 s windows of the same audio returned every word. Splitting at
 * an existing pause never cuts a word; short utterances are still sent whole.
 */
export function recognitionWindows(pcm: Pcm, opts: WindowOptions = {}): Array<{ startMs: number; endMs: number }> {
  const maxMs = opts.maxMs ?? 12_000
  const minMs = opts.minMs ?? 4_000
  const threshold = opts.thresholdDb ?? -48
  const frameMs = 20
  const frame = Math.round((frameMs / 1000) * pcm.sampleRate)
  const frames = Math.floor(pcm.samples.length / frame)
  const totalMs = Math.round((pcm.samples.length / pcm.sampleRate) * 1000)
  if (totalMs <= maxMs) return [{ startMs: 0, endMs: totalMs }]
  const level: number[] = []
  for (let f = 0; f < frames; f++) level.push(rmsDbfs(pcm.samples, f * frame, (f + 1) * frame))
  const windows: Array<{ startMs: number; endMs: number }> = []
  let start = 0
  while (frames - start > maxMs / frameMs) {
    const lo = start + Math.round(minMs / frameMs)
    const hi = Math.min(frames - 1, start + Math.round(maxMs / frameMs))
    // Prefer the middle of the longest silent run in [lo, hi]; else the quietest single frame.
    let best = -1, bestLen = 0, run = 0
    for (let f = lo; f <= hi; f++) {
      run = level[f] <= threshold ? run + 1 : 0
      if (run > bestLen) { bestLen = run; best = f - Math.floor(run / 2) }
    }
    if (best < 0) {
      best = lo
      for (let f = lo; f <= hi; f++) if (level[f] < level[best]) best = f
    }
    windows.push({ startMs: start * frameMs, endMs: best * frameMs })
    start = best
  }
  windows.push({ startMs: start * frameMs, endMs: totalMs })
  return windows
}

/** Recognizes one SpashtAI utterance as the candidate hears it, window by window, in order. */
export async function transcribeUtterance(stt: Recognizer, pcm: Pcm, signal?: AbortSignal, opts: WindowOptions = {}): Promise<{ text: string; parts: RecognitionPart[] }> {
  const parts: RecognitionPart[] = []
  for (const w of recognitionWindows(pcm, opts)) {
    const slice: Pcm = { sampleRate: pcm.sampleRate, channels: 1,
      samples: pcm.samples.subarray(Math.round((w.startMs / 1000) * pcm.sampleRate), Math.round((w.endMs / 1000) * pcm.sampleRate)) }
    parts.push({ ...w, text: (await stt.transcribe(slice, signal)).trim() })
  }
  return { text: parts.map(p => p.text).filter(Boolean).join(' '), parts }
}
