import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium } from 'playwright'
import { encodeWav, rmsDbfs, type Pcm } from './audio/pcm.js'
import { AudioBridge, type Utterance } from './browser/bridge.js'
import { Evidence, newRunId } from './report/evidence.js'
import { browserArgs } from './browser/launch.js'

/** Deterministic fixture: tone bursts with gaps longer than the VAD end-silence, so each burst is one utterance. */
export function burstFixture(opts: { sampleRate?: number; bursts?: number; burstMs?: number; gapMs?: number; leadMs?: number } = {}): { pcm: Pcm; bursts: Array<{ startMs: number; endMs: number }> } {
  const sr = opts.sampleRate ?? 24_000, n = opts.bursts ?? 3, burst = opts.burstMs ?? 700, gap = opts.gapMs ?? 1300, lead = opts.leadMs ?? 300
  const total = lead + n * burst + (n - 1) * gap + 300
  const samples = new Int16Array(Math.round((total / 1000) * sr))
  const bursts: Array<{ startMs: number; endMs: number }> = []
  for (let b = 0; b < n; b++) {
    const startMs = lead + b * (burst + gap)
    bursts.push({ startMs, endMs: startMs + burst })
    const s0 = Math.round((startMs / 1000) * sr), s1 = Math.round(((startMs + burst) / 1000) * sr)
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / sr
      // Speech-band carrier with syllable-rate amplitude modulation survives Opus and echo processing.
      const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)
      samples[i] = Math.round(9000 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 660 * t)))
    }
  }
  return { pcm: { sampleRate: sr, channels: 1, samples }, bursts }
}

const LOOPBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>vtc loopback</title><audio id="out" autoplay></audio>
<button id="go">Start</button><pre id="log"></pre>
<script>
document.getElementById('go').onclick = async () => {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } })
  window.__micTrack = mic.getAudioTracks()[0]
  const a = new RTCPeerConnection(), b = new RTCPeerConnection()
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate)
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate)
  b.ontrack = e => { document.getElementById('out').srcObject = e.streams[0] }
  a.addTrack(window.__micTrack, mic)
  await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription)
  await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription)
  document.getElementById('log').textContent = 'connected'
}
</script>`

export interface DiagnoseResult { passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }>; dir: string }

/** Layer-1 validation without SpashtAI or any provider: virtual mic -> WebRTC -> incoming tap. */
export async function diagnoseTransport(opts: { outputDir: string; headed?: boolean; channel?: string }): Promise<DiagnoseResult> {
  const evidence = new Evidence(opts.outputDir, `diagnose-${newRunId()}`)
  const server: Server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(LOOPBACK_PAGE) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://localhost:${(server.address() as AddressInfo).port}/`
  const browser = await chromium.launch({ headless: !opts.headed, channel: opts.channel, args: browserArgs({ muteSpeakers: true }) })
  const checks: DiagnoseResult['checks'] = []
  const check = (name: string, passed: boolean, detail: string) => { checks.push({ name, passed, detail }); evidence.event('verify', name, { passed, detail }) }
  try {
    const context = await browser.newContext()
    const bridge = new AudioBridge(evidence, { endSilenceMs: 600 })
    await bridge.install(context)
    const utterances: Utterance[] = []
    bridge.on({ utterance: u => utterances.push(u) })
    const page = await context.newPage()
    bridge.page = page
    await page.goto(url)
    await page.click('#go')
    await page.waitForFunction(() => document.getElementById('log')?.textContent === 'connected', null, { timeout: 15_000 })
    await page.waitForTimeout(1500)
    check('virtual_mic_and_incoming_tapped', bridge.incomingStreamCount() > 0 && bridge.micStreamCount() > 0,
      `incoming taps=${bridge.incomingStreamCount()} mic taps=${bridge.micStreamCount()}`)

    const fixture = burstFixture()
    evidence.writeBinary('audio/fixture.wav', encodeWav(fixture.pcm))
    // Sent as two chunks split inside a gap: exercises gap-free scheduling of streamed synthesis.
    const cut = Math.round(((fixture.bursts[1].endMs + 600) / 1000) * fixture.pcm.sampleRate)
    const halves = [fixture.pcm.samples.slice(0, cut), fixture.pcm.samples.slice(cut)].map(samples => encodeWav({ ...fixture.pcm, samples }))
    const { started, finished } = await bridge.play('fixture-1', (async function* () { yield* halves })())
    const done = await finished
    check('chunked_playback_gap_free', done.underruns === 0, `underruns: ${done.underruns}`)
    await page.waitForTimeout(1500)
    const heard = utterances.filter(u => u.endEpoch > started.startEpoch)
    const latencies = heard.slice(0, fixture.bursts.length).map((u, i) => Math.round(u.startEpoch - (started.startEpoch + fixture.bursts[i].startMs)))
    const durations = heard.map(u => Math.round(u.endEpoch - u.startEpoch))
    check('generated_audio_reaches_incoming_stream', heard.length === fixture.bursts.length,
      `expected ${fixture.bursts.length} utterances, detected ${heard.length}; durations ms ${durations.join(', ')}`)
    check('utterance_durations_preserved', durations.length === fixture.bursts.length && durations.every(d => Math.abs(d - 700) < 250),
      `fixture bursts 700 ms; detected ${durations.join(', ')}`)
    check('transport_latency_bounded', latencies.length > 0 && latencies.every(l => l > -100 && l < 1000),
      `start latency ms (virtual mic -> WebRTC -> tap): ${latencies.join(', ')}`)

    // A disabled track must carry silence: proves the microphone evidence reflects the app's own gating.
    await page.evaluate(() => { (window as any).__micTrack.enabled = false })
    const before = utterances.length
    const second = await bridge.play('fixture-2', encodeWav(fixture.pcm))
    await second.finished
    await page.waitForTimeout(1500)
    check('disabled_track_carries_silence', utterances.length === before, `utterances while disabled: ${utterances.length - before}`)

    bridge.flush()
    const written = bridge.writeEvidence()
    evidence.writeJson('audio-files.json', written)
    const state = await bridge.state()
    evidence.writeJson('browser/state.json', state)
    const micLevel = heard[0] ? rmsDbfs(heard[0].pcm.samples).toFixed(1) : 'n/a'
    evidence.event('tool', 'diagnose_levels', { firstUtteranceDbfs: micLevel })
    await context.close()
  } catch (error) {
    check('diagnose_completed', false, error instanceof Error ? error.message : String(error))
  } finally {
    await browser.close()
    server.close()
  }
  const passed = checks.length > 0 && checks.every(c => c.passed)
  evidence.writeJson('diagnose.json', { passed, checks, note: 'Provider-free loopback inside one test browser. Not an end-to-end SpashtAI run.' })
  return { passed, checks, dir: evidence.dir }
}
