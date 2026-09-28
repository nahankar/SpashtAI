import express from 'express'
import request from 'supertest'
import { mkdtemp, readdir, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeStreamingWords, wordSegments } from '../src/lib/replay-word-evidence'

const state = vi.hoisted(() => ({
  session: null as any,
  replayAudioUpload: true,
  stream: vi.fn(),
  analyze: vi.fn(),
  progress: vi.fn(),
  receipt: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(),
    replaySession: {
      findFirst: vi.fn(async ({ where }: any) => state.session && (!where.userId || where.userId === state.session.userId) ? state.session : null),
      findUnique: vi.fn(async () => state.session),
      update: vi.fn(async ({ data }: any) => { if (!state.session) throw new Error('Deleted'); Object.assign(state.session, data); return state.session }),
      delete: vi.fn(async () => { state.session = null }),
    },
    replayUpload: { create: vi.fn(async ({ data }: any) => { const file = { id: `file-${state.session.uploadedFiles.length}`, ...data }; state.session.uploadedFiles.unshift(file); return file }) },
    replayResult: {
      create: vi.fn(async ({ data }: any) => { if (!state.session) throw new Error('Deleted'); state.session.result = data; return data }),
      deleteMany: vi.fn(async () => { state.session.result = null }),
      update: vi.fn(async ({ data }: any) => { Object.assign(state.session.result, data); return state.session.result }),
    },
    progressPulse: { deleteMany: state.progress, findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) }, coachHomeResultReceipt: { deleteMany: state.receipt },
    user: {
      findUnique: vi.fn(async () => ({
        enablePro: true,
        enableUltra: true,
        enableReplayAudioUpload: state.replayAudioUpload,
      })),
    },
  }
  return { prisma: { ...tx, $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('../src/middleware/tracking', () => ({ trackFeatureUsage: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('../src/lib/analysisConfig', () => ({ getReplayModelId: async () => 'mock-only' }))
vi.mock('../src/lib/aws-bedrock', () => ({ analyzeTranscript: state.analyze }))
vi.mock('../src/lib/aws-transcribe-streaming', () => ({ transcribeStreamingFromFile: state.stream }))
vi.mock('../src/lib/aws-transcribe', () => ({ uploadToS3: vi.fn(), startTranscriptionJob: vi.fn(), pollTranscriptionJob: vi.fn(), fetchTranscriptionResult: vi.fn(), mediaFormatFromMime: vi.fn() }))
vi.mock('../src/analytics/insightGenerator', () => ({ generateCoachingInsights: vi.fn(async () => ({ meetingSummary: { topicsDiscussed: ['Project'], keyOutcomes: [], openQuestions: [] } })) }))
vi.mock('../src/lib/replay-recording', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/replay-recording')>(),
  identifyReplayRecording: vi.fn(async (file: any) => ({ uploadId: file.id, signature: 'synthetic-audio', duration: 45, timelineOrigin: 'retained_media_seconds' })),
}))

describe('Replay upload, cached analysis and deletion workflow (mocked providers/DB)', () => {
  const app = express()
  let directory: string
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'replay-evidence-workflow-'))
    process.env.REPLAY_UPLOAD_PATH = directory
    app.use(express.json())
    app.use((req, _res, next) => { (req as any).user = { userId: req.header('test-user') || 'owner', role: 'USER' }; next() })
    app.use('/api/replay', (await import('../src/routes/replay')).default)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    state.replayAudioUpload = true
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    state.session = { id: `s-${Math.random().toString(36).slice(2)}`, userId: 'owner', status: 'pending', uploadedFiles: [], result: null,
      meetingDate: new Date('2026-01-01T00:00:00Z'), meetingType: 'Review', userRole: 'Participant', focusAreas: [] }
    const raw = normalizeStreamingWords(Array.from({ length: 40 }, (_, i) => ({ Type: 'pronunciation', Content: `word${i}`,
      StartTime: i < 20 ? i / 2 : i / 2 + 10, EndTime: (i < 20 ? i / 2 : i / 2 + 10) + .5, Speaker: 'spk_1' })), true)
    const segments = wordSegments(raw)
    state.stream.mockResolvedValue({ wordEvidence: raw, segments, fullText: segments.map(s => s.text).join(' '), speakerCount: 1 })
    state.analyze.mockResolvedValue({ clarityScore: 8, confidenceScore: 7, engagementScore: 8, strengths: [{ point: 'Clear next step' }],
      improvements: [], recommendations: [], contextSpecificFeedback: [], keyMoments: [], annotatedTranscript: [], promptTokens: 1, completionTokens: 1 })
  })
  afterAll(async () => { vi.unstubAllGlobals(); delete process.env.REPLAY_UPLOAD_PATH; await rm(directory, { recursive: true, force: true }) })
  const path = () => `/api/replay/sessions/${state.session.id}`
  async function processSession(body = {}) {
    expect((await request(app).post(`${path()}/process`).send(body)).status).toBe(200)
    await vi.waitFor(() => expect(state.session.status).toBe('completed'))
  }
  it('rejects unauthorized uploads before writing any multipart file', async () => {
    const before = await readdir(directory)
    expect((await request(app).post(`${path()}/upload`).set('test-user', 'intruder').attach('audio', Buffer.from('synthetic'), 'test.wav')).status).toBe(404)
    expect(await readdir(directory)).toEqual(before)
  })
  it('rejects audio uploads unless an admin enabled them for the user', async () => {
    state.replayAudioUpload = false
    const response = await request(app)
      .post(`${path()}/upload`)
      .attach('audio', Buffer.from('synthetic'), 'test.wav')
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: 'REPLAY_AUDIO_UPLOAD_DISABLED',
      error: 'Replay audio and video upload is coming soon for your account.',
    })
    const video = await request(app)
      .post(`${path()}/upload`)
      .attach('audio', Buffer.from('synthetic'), { filename: 'clip.mp4', contentType: 'video/mp4' })
    expect(video.status).toBe(403)
    expect(video.body.code).toBe('REPLAY_AUDIO_UPLOAD_DISABLED')
  })
  it('keeps content-only uploads usable without inventing pace, and deletes local artifacts', async () => {
    const uploaded = await request(app).post(`${path()}/upload`).send({ text: 'Alice: The project needs a clear owner.\nBob: I can own the next step.' })
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.uploads[0].storedPath).toBeUndefined()
    const stored = state.session.uploadedFiles[0].storedPath
    expect(await readFile(stored, 'utf8')).toContain('clear owner')
    await processSession()
    const results = await request(app).get(`${path()}/results`)
    expect(results.status).toBe(200)
    expect(results.body.result.wordsPerMinute).toBeNull()
    expect(results.body.result.strengths).toEqual([])
    expect(state.stream).not.toHaveBeenCalled()
    expect((await request(app).delete(path())).status).toBe(200)
    await expect(readFile(stored)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('prepares a transcript before date confirmation but requires the date for personalized analysis', async () => {
    state.session.meetingDate = null
    const speech = Array.from({ length: 45 }, (_, index) => `word${index}`).join(' ')
    expect((await request(app).post(`${path()}/upload`).send({ text: `Alice: ${speech}\nAlice: closing thought` })).status).toBe(200)
    await processSession()
    expect(state.analyze).not.toHaveBeenCalled()
    const first = (await request(app).get(`${path()}/results`)).body
    expect(first.evidence.speakers[0].speaker).toBe('Alice')
    expect((await request(app).put(`${path()}/learner`).send({
      speaker: 'Alice',
      transcriptRevision: first.evidence.transcriptRevision,
      recordingSignature: null,
      selectionRevision: null,
    })).status).toBe(200)
    expect((await request(app).post(`${path()}/process`).send({
      selectionRevision: state.session.learnerSelection.revision,
      transcriptRevision: first.evidence.transcriptRevision,
    })).status).toBe(400)
    expect(state.analyze).not.toHaveBeenCalled()
  })
  it('reuses audio word cache after confirming a speaker and keeps conflicting uploaded text separate', async () => {
    expect((await request(app).post(`${path()}/upload`).attach('audio', Buffer.from('synthetic test bytes'), 'test.wav').field('text', 'Alice: Different supplied wording.')).status).toBe(200)
    await processSession()
    expect(state.analyze).not.toHaveBeenCalled()
    const first = (await request(app).get(`${path()}/results`)).body
    expect(first.evidence.identity.state).toBe('confirmation_required')
    expect(first.evidence.supplementaryTranscript.status).toBe('different_not_aligned')
    expect(first.skillScores).toBeNull()
    expect((await request(app).put(`${path()}/learner`).send({ speaker: 'spk_1', transcriptRevision: first.evidence.transcriptRevision,
      recordingSignature: first.evidence.recording.signature, selectionRevision: null })).status).toBe(200)
    const preservedResult = state.session.result
    expect((await request(app).post(`${path()}/process`).send({
      selectionRevision: 'obsolete', transcriptRevision: first.evidence.transcriptRevision,
    })).status).toBe(409)
    expect(state.session.result).toBe(preservedResult)
    // Names remain metadata; only explicit confirmation chooses the learner.
    await request(app).patch(path()).send({ participantName: 'Another person' })
    await processSession({
      selectionRevision: state.session.learnerSelection.revision,
      transcriptRevision: first.evidence.transcriptRevision,
    })
    expect(state.analyze).toHaveBeenCalledTimes(1)
    expect(state.stream).toHaveBeenCalledTimes(1)
    const next = (await request(app).get(`${path()}/results`)).body
    expect(next.evidence.pace.wpm).toBe(120)
    expect(next.skillScores).not.toBeNull()
    expect(next.evidence.identity.speaker).toBe('spk_1')
    expect(next.result.transcriptText).not.toContain('Different supplied')
    const cache = join(directory, `${state.session.id}_transcription.json`)
    expect((JSON.parse(await readFile(cache, 'utf8'))).wordEvidence.words).toHaveLength(40)
    expect((await request(app).delete(path())).status).toBe(200)
    await expect(readFile(cache)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not generate scores from one short confirmed utterance', async () => {
    const text = 'Alice: one two three four five six seven eight\nAlice: nine ten eleven'
    expect((await request(app).post(`${path()}/upload`).send({ text })).status).toBe(200)
    await processSession()
    const first = (await request(app).get(`${path()}/results`)).body
    expect(first.evidence.speakers.map((item: { speaker: string }) => item.speaker)).toEqual(['Alice'])
    expect(first.evidence.speakers[0].assessmentEligible).toBe(false)
    expect((await request(app).put(`${path()}/learner`).send({
      speaker: 'Alice',
      transcriptRevision: first.evidence.transcriptRevision,
      recordingSignature: null,
      selectionRevision: null,
    })).status).toBe(200)
    await processSession({
      selectionRevision: state.session.learnerSelection.revision,
      transcriptRevision: first.evidence.transcriptRevision,
    })
    expect(state.analyze).not.toHaveBeenCalled()
    const next = (await request(app).get(`${path()}/results`)).body
    expect(next.skillScores).toBeNull()
    expect(next.evidence.assessmentGate).toBe('insufficient_speech')
    expect(next.evidence.identity.speaker).toBe('Alice')
  })
  it('retains the previous successful result when a replacement analysis fails', async () => {
    expect((await request(app).post(`${path()}/upload`).attach('audio', Buffer.from('synthetic test bytes'), 'test.wav')).status).toBe(200)
    await processSession()
    const unconfirmed = (await request(app).get(`${path()}/results`)).body
    expect((await request(app).put(`${path()}/learner`).send({
      speaker: 'spk_1',
      transcriptRevision: unconfirmed.evidence.transcriptRevision,
      recordingSignature: unconfirmed.evidence.recording.signature,
      selectionRevision: null,
    })).status).toBe(200)
    await processSession({
      selectionRevision: state.session.learnerSelection.revision,
      transcriptRevision: unconfirmed.evidence.transcriptRevision,
    })
    const successful = state.session.result
    state.analyze.mockRejectedValueOnce(new Error('bedrock unavailable'))
    expect((await request(app).post(`${path()}/process`).send({
      selectionRevision: state.session.learnerSelection.revision,
      transcriptRevision: unconfirmed.evidence.transcriptRevision,
    })).status).toBe(200)
    await vi.waitFor(() => expect(state.session.status).toBe('failed'))
    expect(state.session.result).toBe(successful)
    const afterFailure = await request(app).get(`${path()}/results`)
    expect(afterFailure.status).toBe(200)
    expect(afterFailure.body.skillScores).not.toBeNull()
  })
  it('cleans rejected uploads when analysis owns the session', async () => {
    state.session.status = 'analyzing'
    const before = await readdir(directory)
    expect((await request(app).post(`${path()}/upload`).send({ text: 'Do not retain this rejected upload.' })).status).toBe(409)
    await vi.waitFor(async () => expect(await readdir(directory)).toEqual(before))
  })
  it('retains valid audio analysis when supplemental text is missing', async () => {
    expect((await request(app).post(`${path()}/upload`).attach('audio', Buffer.from('synthetic'), 'test.wav').field('text', 'Alice: Supplemental text.')).status).toBe(200)
    await unlink(state.session.uploadedFiles.find((f: any) => f.fileType === 'text').storedPath)
    await processSession()
    const response = (await request(app).get(`${path()}/results`)).body
    expect(response.evidence.supplementaryTranscript.status).toBe('unavailable')
    expect(response.result.transcriptText).toContain('word0')
    expect(response.result.speakerCount).toBe(1)
    expect((await request(app).delete(path())).status).toBe(200)
  })
  it('retries incomplete transcription on explicit re-analysis instead of caching failure forever', async () => {
    expect((await request(app).post(`${path()}/upload`).attach('audio', Buffer.from('synthetic'), 'test.wav')).status).toBe(200)
    const complete = await state.stream()
    state.stream.mockClear()
    state.stream.mockResolvedValueOnce({ ...complete, wordEvidence: { ...complete.wordEvidence, complete: false } })
    await processSession()
    await processSession()
    expect(state.stream).toHaveBeenCalledTimes(2)
    expect(state.session.result.deliveryEvidence.words.complete).toBe(true)
    expect((await request(app).delete(path())).status).toBe(200)
  })
})
