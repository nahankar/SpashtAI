import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { logInterview } from '@/lib/prepare-api'
import {
  INTERVIEW_OUTCOMES,
  INTERVIEW_RATINGS,
  PREPARE_TEXT_LIMITS,
  type InterviewOutcome,
  type InterviewRating,
  type Preparation,
} from '@/lib/prepare-types'

export function LogInterviewDialog({
  journey,
  open,
  defaultStageId,
  onOpenChange,
  onLogged,
}: {
  journey: Preparation
  open: boolean
  defaultStageId?: string | null
  onOpenChange: (open: boolean) => void
  onLogged: (preparation: Preparation) => void
}) {
  const initialStageId =
    defaultStageId ||
    journey.nextStage?.id ||
    journey.stages.find((stage) => stage.status !== 'SKIPPED')?.id ||
    journey.stages[0]?.id ||
    ''
  const [stageId, setStageId] = useState(initialStageId)
  const [rating, setRating] = useState<InterviewRating | ''>('')
  const [outcome, setOutcome] = useState<InterviewOutcome | ''>('')
  const [wentWell, setWentWell] = useState('')
  const [difficulties, setDifficulties] = useState('')
  const [surprisedBy, setSurprisedBy] = useState('')
  const [feedbackReceived, setFeedbackReceived] = useState('')
  const [nextRoundHints, setNextRoundHints] = useState('')
  const [questionsText, setQuestionsText] = useState('')
  const [nextStageScheduledAt, setNextStageScheduledAt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setStageId(initialStageId)
  }, [open, initialStageId])

  useEffect(() => {
    if (!open) return
    const reflection = journey.stages.find((stage) => stage.id === stageId)?.reflection
    setRating(reflection?.rating ?? '')
    setOutcome(reflection?.outcome ?? '')
    setWentWell(reflection?.wentWell ?? '')
    setDifficulties(reflection?.difficulties ?? '')
    setSurprisedBy(reflection?.surprisedBy ?? '')
    setFeedbackReceived(reflection?.feedbackReceived ?? '')
    setNextRoundHints(reflection?.nextRoundHints ?? '')
    setQuestionsText('')
    setNextStageScheduledAt('')
  }, [open, stageId, journey.stages])

  const selectedStage = useMemo(
    () => journey.stages.find((stage) => stage.id === stageId),
    [journey.stages, stageId],
  )

  async function submit() {
    if (!stageId) {
      toast.error('Choose which round this was')
      return
    }
    setSaving(true)
    try {
      const preparation = await logInterview(journey.id, {
        stageId,
        ...(rating ? { rating } : {}),
        ...(outcome ? { outcome } : {}),
        ...(wentWell.trim() ? { wentWell: wentWell.trim() } : {}),
        ...(difficulties.trim() ? { difficulties: difficulties.trim() } : {}),
        ...(surprisedBy.trim() ? { surprisedBy: surprisedBy.trim() } : {}),
        ...(feedbackReceived.trim() ? { feedbackReceived: feedbackReceived.trim() } : {}),
        ...(nextRoundHints.trim() ? { nextRoundHints: nextRoundHints.trim() } : {}),
        ...(questionsText.trim() ? { questionsText: questionsText.trim() } : {}),
        ...(nextStageScheduledAt
          ? { nextStageScheduledAt: new Date(nextStageScheduledAt).toISOString() }
          : {}),
      })
      onLogged(preparation)
      onOpenChange(false)
      toast.success('Interview logged')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not log interview')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {selectedStage?.status === 'COMPLETED' ? 'Update interview log' : 'Log interview'}
          </DialogTitle>
          <DialogDescription>
            Dump what you remember. This stays on the {journey.interview.companyName} journey — no
            recording required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Which round?</p>
            <div className="flex flex-wrap gap-1.5">
              {journey.stages.map((stage) => (
                <Button
                  key={stage.id}
                  type="button"
                  size="sm"
                  variant={stageId === stage.id ? 'default' : 'outline'}
                  className="h-7 rounded-full text-xs"
                  onClick={() => setStageId(stage.id)}
                >
                  {stage.name}
                </Button>
              ))}
            </div>
            {selectedStage?.status === 'SKIPPED' && (
              <p className="text-xs text-muted-foreground">
                Logging this round marks it completed. Other skipped rounds stay skipped.
              </p>
            )}
            {(selectedStage?.questionCount ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedStage?.questionCount} question
                {selectedStage?.questionCount === 1 ? '' : 's'} already saved for this round.
                Add more below — existing lines are not duplicated.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">How did it go?</p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVIEW_RATINGS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={rating === option.value ? 'default' : 'outline'}
                  className="h-7 rounded-full text-xs"
                  onClick={() => setRating(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {INTERVIEW_OUTCOMES.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={outcome === option.value ? 'default' : 'outline'}
                  className="h-7 rounded-full text-xs"
                  onClick={() => setOutcome(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-well">What went well?</Label>
            <Textarea
              id="log-well"
              rows={2}
              maxLength={PREPARE_TEXT_LIMITS.reflectionText}
              value={wentWell}
              onChange={(event) => setWentWell(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-hard">What was difficult?</Label>
            <Textarea
              id="log-hard"
              rows={2}
              maxLength={PREPARE_TEXT_LIMITS.reflectionText}
              value={difficulties}
              onChange={(event) => setDifficulties(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-surprise">What surprised you?</Label>
            <Textarea
              id="log-surprise"
              rows={2}
              maxLength={PREPARE_TEXT_LIMITS.reflectionText}
              value={surprisedBy}
              onChange={(event) => setSurprisedBy(event.target.value)}
              placeholder="Expected system design, got underperformer management…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-questions">What did they ask?</Label>
            <Textarea
              id="log-questions"
              rows={6}
              maxLength={PREPARE_TEXT_LIMITS.questionsText}
              value={questionsText}
              onChange={(event) => setQuestionsText(event.target.value)}
              placeholder={'One question per line\n- Tell me about a time you disagreed with a peer\n- How would you design a rate limiter?'}
            />
            <p className="text-xs text-muted-foreground">
              One line = one question. Bullets and numbers are stripped.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-feedback">Feedback, clues, next-round hints</Label>
            <Textarea
              id="log-feedback"
              rows={2}
              maxLength={PREPARE_TEXT_LIMITS.reflectionText}
              value={feedbackReceived}
              onChange={(event) => setFeedbackReceived(event.target.value)}
              placeholder="What they hinted about the next round, or feedback they gave"
            />
            <Textarea
              rows={2}
              maxLength={PREPARE_TEXT_LIMITS.reflectionText}
              value={nextRoundHints}
              onChange={(event) => setNextRoundHints(event.target.value)}
              placeholder="What you want to practice before the next stage"
              aria-label="Next-round hints"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-next">Next interview date (optional)</Label>
            <Input
              id="log-next"
              type="datetime-local"
              value={nextStageScheduledAt}
              onChange={(event) => setNextStageScheduledAt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Schedules the next incomplete round
              {journey.nextStage && journey.nextStage.id !== stageId
                ? ` (${journey.nextStage.name})`
                : ''}
              .
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
