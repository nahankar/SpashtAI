/** Mono or interleaved 16-bit PCM helpers. All audio inside the tool is Int16 at an explicit sample rate. */

export interface Pcm {
  sampleRate: number
  channels: number
  /** Interleaved samples when channels > 1. */
  samples: Int16Array
}

export function durationMs(pcm: Pcm): number {
  return (pcm.samples.length / pcm.channels / pcm.sampleRate) * 1000
}

export function encodeWav(pcm: Pcm): Buffer {
  const dataBytes = pcm.samples.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(pcm.channels, 22)
  header.writeUInt32LE(pcm.sampleRate, 24)
  header.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28)
  header.writeUInt16LE(pcm.channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  const body = Buffer.from(pcm.samples.buffer, pcm.samples.byteOffset, dataBytes)
  return Buffer.concat([header, body])
}

/** Decodes PCM WAV (8/16/24/32-bit integer or 32-bit float) into 16-bit samples. Mixes down to mono when asked. */
export function decodeWav(buffer: Buffer, opts: { mono?: boolean } = {}): Pcm {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }
  let offset = 12
  let format = 0, channels = 0, sampleRate = 0, bits = 0
  let data: Buffer | null = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    let size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    // Streaming encoders sometimes write 0 or 0xFFFFFFFF for an unknown data length.
    if (id === 'data' && (size === 0 || size === 0xffffffff || start + size > buffer.length)) size = buffer.length - start
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(start)
      channels = buffer.readUInt16LE(start + 2)
      sampleRate = buffer.readUInt32LE(start + 4)
      bits = buffer.readUInt16LE(start + 14)
      if (format === 0xfffe && size >= 26) format = buffer.readUInt16LE(start + 24)
    } else if (id === 'data') {
      data = buffer.subarray(start, start + size)
    }
    offset = start + size + (size % 2)
  }
  if (!data || !channels || !sampleRate) throw new Error('WAV is missing fmt or data chunk')
  const bytesPerSample = bits / 8
  const frameCount = Math.floor(data.length / (bytesPerSample * channels))
  const out = new Int16Array(frameCount * channels)
  for (let i = 0; i < frameCount * channels; i++) {
    const p = i * bytesPerSample
    let v: number
    if (format === 3 && bits === 32) v = Math.max(-1, Math.min(1, data.readFloatLE(p))) * 32767
    else if (bits === 16) v = data.readInt16LE(p)
    else if (bits === 8) v = (data.readUInt8(p) - 128) << 8
    else if (bits === 24) v = data.readIntLE(p, 3) >> 8
    else if (bits === 32) v = data.readInt32LE(p) >> 16
    else throw new Error(`Unsupported WAV sample format: ${bits}-bit format ${format}`)
    out[i] = v
  }
  const pcm: Pcm = { sampleRate, channels, samples: out }
  return opts.mono && channels > 1 ? toMono(pcm) : pcm
}

export function toMono(pcm: Pcm): Pcm {
  if (pcm.channels === 1) return pcm
  const frames = pcm.samples.length / pcm.channels
  const out = new Int16Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let c = 0; c < pcm.channels; c++) sum += pcm.samples[f * pcm.channels + c]
    out[f] = Math.round(sum / pcm.channels)
  }
  return { sampleRate: pcm.sampleRate, channels: 1, samples: out }
}

/**
 * Mono resampler: box-filter when decimating (adequate anti-aliasing for speech evidence and recognition),
 * linear interpolation otherwise.
 */
export function resample(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return samples
  const ratio = from / to
  const outLength = Math.floor(samples.length / ratio)
  const out = new Int16Array(outLength)
  if (ratio > 1) {
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
      let sum = 0
      for (let j = start; j < end; j++) sum += samples[j]
      out[i] = Math.round(sum / (end - start))
    }
  } else {
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio
      const j = Math.floor(pos)
      const frac = pos - j
      const a = samples[j] ?? 0
      const b = samples[j + 1] ?? a
      out[i] = Math.round(a + (b - a) * frac)
    }
  }
  return out
}

export function silence(ms: number, sampleRate: number): Int16Array {
  return new Int16Array(Math.round((ms / 1000) * sampleRate))
}

export function concat(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** RMS level in dBFS; -Infinity for digital silence. */
export function rmsDbfs(samples: Int16Array, start = 0, end = samples.length): number {
  if (end <= start) return -Infinity
  let sum = 0
  for (let i = start; i < end; i++) { const v = samples[i] / 32768; sum += v * v }
  const rms = Math.sqrt(sum / (end - start))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

export function int16FromBase64(b64: string): Int16Array {
  const buf = Buffer.from(b64, 'base64')
  const copy = new Int16Array(buf.length / 2)
  for (let i = 0; i < copy.length; i++) copy[i] = buf.readInt16LE(i * 2)
  return copy
}

/** Measures runs of near-silence inside an utterance (e.g. deliberate hesitation gaps), in ms. */
export function internalPauses(pcm: Pcm, opts: { thresholdDb?: number; minPauseMs?: number; frameMs?: number } = {}): number[] {
  const mono = toMono(pcm)
  const frame = Math.max(1, Math.round(((opts.frameMs ?? 20) / 1000) * mono.sampleRate))
  const threshold = opts.thresholdDb ?? -45
  const minPause = opts.minPauseMs ?? 400
  const voiced: boolean[] = []
  for (let i = 0; i + frame <= mono.samples.length; i += frame) voiced.push(rmsDbfs(mono.samples, i, i + frame) > threshold)
  const first = voiced.indexOf(true)
  const last = voiced.lastIndexOf(true)
  if (first < 0) return []
  const pauses: number[] = []
  let run = 0
  for (let i = first; i <= last; i++) {
    if (!voiced[i]) run++
    else { if (run * (opts.frameMs ?? 20) >= minPause) pauses.push(run * (opts.frameMs ?? 20)); run = 0 }
  }
  return pauses
}
