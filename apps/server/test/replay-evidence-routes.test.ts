import express from 'express'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyInput } from '../src/lib/replay-evidence'

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), resultUpdate: vi.fn(), pulseDelete: vi.fn(), pulseCreate: vi.fn(), pulseUpdate: vi.fn(), user: vi.fn(), identify: vi.fn() }))
vi.mock('../src/lib/prisma', () => {
  const tx = { $queryRaw: vi.fn(), replaySession: { findFirst: mocks.find, findUnique: mocks.find, update: mocks.update },
    replayResult: { update: mocks.resultUpdate }, progressPulse: { deleteMany: mocks.pulseDelete, createMany: mocks.pulseCreate, updateMany: mocks.pulseUpdate }, user: { findUnique: mocks.user } }
  return { prisma: { ...tx, $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('../src/lib/replay-recording', () => ({ identifyReplayRecording: mocks.identify, replayCacheKey: vi.fn() }))
vi.mock('../src/analytics/insightGenerator', () => ({ generateCoachingInsights: vi.fn(), resolveReplayUploadAudio: vi.fn() }))
vi.mock('../src/lib/aws-bedrock', () => ({ analyzeTranscript: vi.fn() }))
vi.mock('../src/lib/aws-transcribe', () => ({ uploadToS3: vi.fn(), startTranscriptionJob: vi.fn(), pollTranscriptionJob: vi.fn(), fetchTranscriptionResult: vi.fn(), mediaFormatFromMime: vi.fn() }))
vi.mock('../src/lib/aws-transcribe-streaming', () => ({ transcribeStreamingFromFile: vi.fn() }))

describe('Replay evidence route access and identity invalidation', () => {
  const app = express()
  const segments = [{ speaker: 'Alice', text: 'A clear next step is to send the plan.' }, { speaker: 'Bob', text: 'We can review tomorrow.' }]
  const input = legacyInput(segments, 'uploaded')
  let row: Record<string, any>
  beforeAll(async () => {
    app.use(express.json())
    app.use((req, _res, next) => { (req as any).user = { userId: req.header('test-user') || 'owner', role: 'USER' }; next() })
    app.use('/api/replay', (await import('../src/routes/replay')).default)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    row = { id: 'session', userId: 'owner', status: 'completed', learnerSelection: null, uploadedFiles: [],
      result: { transcriptionSource: 'uploaded', transcriptText: 'private transcript', structuredTranscript: segments, deliveryEvidence: input,
        wordsPerMinute: 150, overallScore: 9, coachingInsights: { primaryImprovement: 'Old learner advice', meetingSummary: { topicsDiscussed: ['Project plan'], keyOutcomes: [], openQuestions: [] } } } }
    mocks.find.mockImplementation(async ({ where }: any) => where?.userId && where.userId !== row.userId ? null : row)
    mocks.user.mockResolvedValue({ enablePro: true, enableUltra: false, hideAudioDownload: false, hideTranscriptText: false })
    mocks.update.mockImplementation(async ({ data }: any) => { Object.assign(row, data); return row })
    mocks.resultUpdate.mockImplementation(async ({ data }: any) => { Object.assign(row.result, data); return row.result })
  })
  const confirmation = { speaker: 'Alice', transcriptRevision: input.transcriptRevision, recordingSignature: null, selectionRevision: null }
  it('rejects another owner without revealing excerpt or file data', async () => {
    const result = await request(app).put('/api/replay/sessions/session/learner').set('test-user', 'intruder').send(confirmation)
    expect(result.status).toBe(404); expect(mocks.update).not.toHaveBeenCalled()
    const media = await request(app).get('/api/replay/sessions/session/media/file').set('test-user', 'intruder')
    expect(media.status).toBe(404); expect(mocks.identify).not.toHaveBeenCalled()
    expect(JSON.stringify(media.body)).not.toContain('private')
  })
  it('rejects stale revisions and arbitrary speaker labels', async () => {
    expect((await request(app).put('/api/replay/sessions/session/learner').send({ ...confirmation, transcriptRevision: 'old' })).status).toBe(409)
    expect((await request(app).put('/api/replay/sessions/session/learner').send({ ...confirmation, speaker: 'spk_0' })).status).toBe(400)
    expect((await request(app).put('/api/replay/sessions/session/learner').send({ ...confirmation, recordingSignature: 'old' })).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('confirms without transcription, clears personal scores but preserves the meeting summary', async () => {
    const response = await request(app).put('/api/replay/sessions/session/learner').send(confirmation)
    expect(response.status).toBe(200)
    expect(row.learnerSelection.provenance).toBe('user_confirmed')
    expect(row.result.coachingInsights.meetingSummary.topicsDiscussed).toEqual(['Project plan'])
    expect(row.result.coachingInsights.primaryImprovement).toBeUndefined()
    expect(mocks.pulseDelete).toHaveBeenCalledWith({ where: { sessionId: 'session', source: 'replay' } })
    const repeated = await request(app).put('/api/replay/sessions/session/learner').send({ ...confirmation, selectionRevision: row.learnerSelection.revision })
    expect(repeated.body.selection.revision).toBe(response.body.selection.revision)
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })
  it('does not change identity during processing', async () => {
    row.status = 'analyzing'
    expect((await request(app).put('/api/replay/sessions/session/learner').send(confirmation)).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('allows reconfirmation when an old persisted selection is no longer applicable', async () => {
    row.learnerSelection = { speaker: 'Alice', revision: 'old', transcriptRevision: 'old-transcript', recordingSignature: null, provenance: 'user_confirmed' }
    expect((await request(app).put('/api/replay/sessions/session/learner').send(confirmation)).status).toBe(200)
    expect(row.learnerSelection.transcriptRevision).toBe(input.transcriptRevision)
  })
  it('allows replacing a removed speaker but rejects stale transcript evidence', async () => {
    row.learnerSelection = { ...confirmation, speaker: 'Removed', revision: 'old', provenance: 'user_confirmed' }
    expect((await request(app).put('/api/replay/sessions/session/learner').send(confirmation)).status).toBe(200)
    mocks.update.mockClear()
    row.result.structuredTranscript = [{ speaker: 'Alice', text: 'Changed transcript' }]
    expect((await request(app).put('/api/replay/sessions/session/learner').send(confirmation)).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('tracks only current server scores and rejects stale speaker submissions', async () => {
    await request(app).put('/api/replay/sessions/session/learner').send(confirmation)
    row.meetingDate = new Date('2026-01-01T00:00:00Z')
    row.result.deliveryEvidence = { ...input, analysisSelectionRevision: row.learnerSelection.revision }
    row.result.skillScores = { scores: { clarity: 8, confidence: 7, conciseness: 6, structure: 5, engagement: 7, pacing: 10, delivery: 10, emotionalControl: 10 } }
    const payload = { selectionRevision: row.learnerSelection.revision, transcriptRevision: input.transcriptRevision, entries: [{ skill: 'pacing', score: 10 }] }
    const response = await request(app).post('/api/replay/sessions/session/track-progress').send(payload)
    expect(response.status).toBe(200)
    const entries = mocks.pulseCreate.mock.calls[0][0].data
    expect(entries.map((e: any) => e.skill)).toEqual(['clarity', 'conciseness', 'confidence', 'structure', 'engagement'])
    expect(entries[0]).toMatchObject({ score: 8, userId: 'owner', recordedAt: row.meetingDate })
    expect((await request(app).post('/api/replay/sessions/session/track-progress').send({ ...payload, selectionRevision: 'old' })).status).toBe(409)
    expect((await request(app).post('/api/replay/sessions/session/track-progress').set('test-user', 'intruder').send(payload)).status).toBe(404)
    expect(mocks.pulseCreate).toHaveBeenCalledTimes(1)
  })
  it('exports honest legacy results and hides protected transcript evidence', async () => {
    const response = await request(app).get('/api/replay/sessions/session/results')
    expect(response.status).toBe(200)
    expect(response.body.result.wordsPerMinute).toBeNull()
    expect(response.body.coachingInsights.meetingSummary.topicsDiscussed).toEqual(['Project plan'])
    expect(response.body.result.deliveryEvidence).toBeUndefined()
    mocks.user.mockResolvedValue({ hideTranscriptText: true, hideAudioDownload: true })
    const hidden = await request(app).get('/api/replay/sessions/session/results')
    expect(hidden.body.result.transcriptText).toBe('')
    expect(hidden.body.evidence.speakers.every((s: any) => s.excerpt === '')).toBe(true)
    expect(hidden.body.coachingInsights).toBeNull()
  })
  it('honors audio restrictions, plans and recording identity before serving bytes', async () => {
    row.uploadedFiles = [{ id: 'file', fileType: 'audio', storedPath: '/not-a-real-file', mimeType: 'audio/wav' }]
    row.result.deliveryEvidence = { ...input, recording: { uploadId: 'file', signature: 'current' } }
    mocks.user.mockResolvedValue({ hideAudioDownload: true, enablePro: true })
    expect((await request(app).get('/api/replay/sessions/session/media/file')).status).toBe(403)
    mocks.user.mockResolvedValue({ hideAudioDownload: false, enablePro: false, enableUltra: false })
    expect((await request(app).get('/api/replay/sessions/session/media/file')).status).toBe(403)
    mocks.user.mockResolvedValue({ hideAudioDownload: false, enablePro: true })
    mocks.identify.mockResolvedValue({ signature: 'changed' })
    expect((await request(app).get('/api/replay/sessions/session/media/file')).status).toBe(409)
  })
  it('keeps tracked dates consistent with session metadata and clears tracking if date is removed', async () => {
    const url = '/api/replay/sessions/session'
    expect((await request(app).patch(url).send({ sessionName: {} })).status).toBe(400)
    expect((await request(app).patch(url).set('test-user', 'intruder').send({ meetingDate: '2026-01-02' })).status).toBe(404)
    expect(mocks.pulseUpdate).not.toHaveBeenCalled()
    expect((await request(app).patch(url).send({ meetingDate: '2026-01-02' })).status).toBe(200)
    expect(mocks.pulseUpdate).toHaveBeenCalledWith({ where: { sessionId: 'session', source: 'replay' }, data: { recordedAt: new Date('2026-01-02') } })
    row.progressPulseStatus = 'tracked'
    expect((await request(app).patch(url).send({ meetingDate: null })).status).toBe(200)
    expect(row.progressPulseStatus).toBeNull()
    expect(mocks.pulseDelete).toHaveBeenCalledWith({ where: { sessionId: 'session', source: 'replay' } })
  })
})
