import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { decodeWav, type Pcm } from './audio/pcm.js'
import { pollUntil, type AdapterContext, type Check } from './adapters/types.js'

/**
 * Saved-recording verification, kept separate from live capture:
 * 1. availability — the stream answers a range request (proves availability only);
 * 2. browser playback — the page's own player advances (UI control first, programmatic fallback labelled);
 * 3. content — the stored file is decoded and contains the candidate's speech (energy + independent recognition).
 * Physical speaker output is never covered (the test browser's output is muted).
 */
export async function verifySavedRecording(ctx: AdapterContext, sessionId: string, candidateTexts: string[], expectedVoicedMs: number): Promise<Check[]> {
  const checks: Check[] = []
  const path = `/sessions/${encodeURIComponent(sessionId)}/recording/stream`
  const available = await pollUntil(async () => {
    const r = await ctx.api.get(path, { Range: 'bytes=0-0' })
    return r.status === 200 || r.status === 206 ? r.status : null
  }, ctx.cfg.verifyTimeoutMs, 5000)
  checks.push({ name: 'recording_available', status: available ? 'passed' : 'pending', required: true, basis: 'api', area: 'saved-recording',
    detail: available ? `recording stream HTTP ${available} (availability only)` : `no recording within ${ctx.cfg.verifyTimeoutMs / 1000} s` })
  if (!available) return checks
  checks.push(await recordingContent(ctx, path, candidateTexts, expectedVoicedMs))
  return checks
}

async function recordingContent(ctx: AdapterContext, path: string, candidateTexts: string[], expectedVoicedMs: number): Promise<Check> {
  const base = { name: 'saved_recording_contains_candidate_speech', required: true, basis: 'audio' as const, area: 'saved-recording' as const }
  const file = await ctx.api.getBytes(path)
  if (!file.body?.length) return { ...base, status: 'failed', detail: `recording download returned HTTP ${file.status} with no body` }
  const ext = /webm/.test(file.contentType) ? 'webm' : /ogg/.test(file.contentType) ? 'ogg' : /wav/.test(file.contentType) ? 'wav' : /mp4|m4a|aac/.test(file.contentType) ? 'm4a' : 'bin'
  ctx.evidence.writeBinary(`audio/saved-recording.${ext}`, file.body)
  let pcm: Pcm
  try { pcm = decodeWithFfmpeg(file.body, ext) } catch (error) {
    return { ...base, status: 'skipped', attribution: 'setup', detail: `could not decode the saved recording (${error instanceof Error ? error.message.split('\n')[0] : error}); install ffmpeg to inspect content` }
  }
  const voiced = voicedRegions(pcm)
  const voicedMs = voiced.reduce((n, r) => n + r.endMs - r.startMs, 0)
  const durationS = (pcm.samples.length / pcm.sampleRate).toFixed(1)
  if (!voiced.length) return { ...base, status: 'failed', detail: `${durationS} s decoded but no voiced audio was found in the saved recording` }
  if (!ctx.transcribe) return { ...base, status: 'skipped', attribution: 'setup', detail: `${durationS} s decoded, ${(voicedMs / 1000).toFixed(1)} s voiced; speech recognition unavailable to confirm content` }
  // Recognize up to three ~20 s windows spread across the voiced audio and compare with what the candidate said.
  const picks = [0, Math.floor(voiced.length / 2), voiced.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i)
  const said = new Set(contentWords(candidateTexts.join(' ')))
  let best = { overlap: 0, text: '' }
  for (const index of picks) {
    const startMs = Math.max(0, voiced[index].startMs - 300)
    const window: Pcm = { sampleRate: pcm.sampleRate, channels: 1, samples: pcm.samples.slice(Math.round((startMs / 1000) * pcm.sampleRate), Math.round(((startMs + 20_000) / 1000) * pcm.sampleRate)) }
    const text = await ctx.transcribe(window).catch(() => '')
    const words = contentWords(text)
    const overlap = words.length ? words.filter(w => said.has(w)).length / words.length : 0
    if (overlap > best.overlap) best = { overlap, text }
  }
  const enoughSpeech = voicedMs >= 0.4 * expectedVoicedMs
  const recognized = best.overlap >= 0.4
  return { ...base, status: enoughSpeech && recognized ? 'passed' : 'failed',
    detail: `${durationS} s decoded, ${(voicedMs / 1000).toFixed(1)} s voiced (candidate's app-track speech: ${(expectedVoicedMs / 1000).toFixed(1)} s); best recognized window shares ${Math.round(best.overlap * 100)}% of its words with the candidate's replies${best.text ? `: "${best.text.slice(0, 120)}"` : ''}` }
}

/** Uses the browser's own player. A UI play control is preferred; a programmatic play() is labelled as such. */
export async function verifyBrowserPlayback(page: Page): Promise<Check> {
  const base = { name: 'saved_recording_plays_in_browser', required: true, basis: 'browser' as const, area: 'saved-recording' as const }
  const audio = page.locator('audio').first()
  if (!await audio.waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false)) {
    const empty = await page.getByText(/No playback available/).first().isVisible().catch(() => false)
    return { ...base, status: 'failed', detail: empty ? 'playback page shows "No playback available"' : 'no audio element on the playback page' }
  }
  // Pages probe the duration of streamed WebM by seeking far past the end; wait until that settles.
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return !!a && a.readyState >= 1 && a.currentTime < 1e6 && !a.seeking }, null, { timeout: 30_000 }).catch(() => undefined)
  const read = () => page.evaluate(() => { const a = document.querySelector('audio')!; return { t: a.currentTime, paused: a.paused, error: a.error?.code ?? null, duration: a.duration, ready: a.readyState } })
  // Prefer the page's own control: a named play button, else the icon-only play button (lucide "play" icon).
  const named = page.getByRole('button', { name: /^(play|play recording|play audio)$/i }).first()
  const icon = page.locator('button:has(svg.lucide-play):not([disabled])').first()
  let how: string
  const initial = await read()
  if (!initial.paused) how = 'the page was already playing (auto-play); no control clicked'
  else if (await named.isVisible().catch(() => false)) { await named.click(); how = 'page play control' }
  else if (await icon.isVisible().catch(() => false)) { await icon.click(); how = 'page play control (icon-only button without an accessible name)' }
  else {
    how = 'programmatic play() on the page audio element (no play control found)'
    await page.evaluate(() => document.querySelector('audio')!.play().catch(() => undefined))
  }
  // Measure while playing: two samples 3 s apart after playback has had time to start.
  await page.waitForTimeout(1500)
  let first = await read()
  if (first.paused && how.startsWith('page play control')) {
    how += '; it did not start playback, programmatic play() used'
    await page.evaluate(() => document.querySelector('audio')!.play().catch(() => undefined))
    await page.waitForTimeout(1500)
    first = await read()
  }
  await page.waitForTimeout(3000)
  const second = await read()
  await page.evaluate(() => document.querySelector('audio')?.pause()).catch(() => undefined)
  const advanced = second.t - first.t
  return { ...base, status: advanced >= 2 && !second.paused && second.error === null ? 'passed' : 'failed',
    detail: `${how}: currentTime ${first.t.toFixed(1)} → ${second.t.toFixed(1)} s over 3 s while playing=${!second.paused} (duration ${Number.isFinite(second.duration) ? second.duration.toFixed(1) : 'unknown'} s, readyState ${second.ready}${second.error !== null ? `, media error ${second.error}` : ''}); browser output muted — speakers not covered` }
}

function decodeWithFfmpeg(data: Buffer, ext: string): Pcm {
  const dir = mkdtempSync(join(tmpdir(), 'vtc-rec-'))
  try {
    const input = join(dir, `in.${ext}`), output = join(dir, 'out.wav')
    writeFileSync(input, data)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', '-f', 'wav', output], { timeout: 120_000, stdio: ['ignore', 'ignore', 'pipe'] })
    return decodeWav(readFileSync(output), { mono: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

export function voicedRegions(pcm: Pcm, thresholdDb = -45, gapMs = 800): Array<{ startMs: number; endMs: number }> {
  const frame = Math.round(0.02 * pcm.sampleRate)
  const threshold = Math.pow(10, thresholdDb / 10) * frame
  const regions: Array<{ startMs: number; endMs: number }> = []
  for (let i = 0; i + frame <= pcm.samples.length; i += frame) {
    let sum = 0
    for (let j = i; j < i + frame; j++) { const v = pcm.samples[j] / 32768; sum += v * v }
    if (sum <= threshold) continue
    const startMs = (i / pcm.sampleRate) * 1000, endMs = startMs + 20
    const last = regions.at(-1)
    if (last && startMs - last.endMs <= gapMs) last.endMs = endMs
    else regions.push({ startMs, endMs })
  }
  return regions.filter(r => r.endMs - r.startMs >= 300)
}

function contentWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
}
