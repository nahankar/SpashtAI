import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ContextForm } from '@/components/replay/ContextForm'
import { UploadZone } from '@/components/replay/UploadZone'
import { ProcessingStatus } from '@/components/replay/ProcessingStatus'
import { useReplaySession } from '@/hooks/useReplaySession'

type Step = 'context' | 'upload' | 'processing'

export function Replay() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('context')
  const {
    sessionId,
    status,
    error,
    loading,
    createSession,
    uploadFiles,
    startProcessing,
  } = useReplaySession()

  const handleContextSubmit = async (data: {
    meetingType: string
    userRole: string
    focusAreas: string[]
    meetingGoal?: string
    meetingDate?: string
  }) => {
    await createSession(data)
    setStep('upload')
  }

  const handleUploadSubmit = async (files: {
    audio?: File
    transcript?: File
    text?: string
  }) => {
    if (!sessionId) return
    await uploadFiles(sessionId, files)
    setStep('processing')
    await startProcessing(sessionId)
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Step indicators */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        {(['context', 'upload', 'processing'] as const).map((s, i) => {
          const labels = ['Context', 'Upload', 'Analysis']
          const isActive = s === step
          const isDone =
            (s === 'context' && step !== 'context') ||
            (s === 'upload' && step === 'processing')
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-6 bg-border" />}
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  isDone
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-2 border-primary text-primary'
                      : 'border border-border text-muted-foreground'
                }`}
              >
                {isDone ? '\u2713' : i + 1}
              </div>
              <span
                className={
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                }
              >
                {labels[i]}
              </span>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {step === 'context' && (
        <ContextForm onSubmit={handleContextSubmit} loading={loading} />
      )}

      {step === 'upload' && (
        <UploadZone onSubmit={handleUploadSubmit} loading={loading} />
      )}

      {step === 'processing' && (
        <ProcessingStatus
          status={status?.status || 'pending'}
          errorMessage={status?.errorMessage}
          onViewResults={
            status?.status === 'completed' && sessionId
              ? () => navigate(`/replay/${sessionId}`)
              : undefined
          }
        />
      )}
    </div>
  )
}
