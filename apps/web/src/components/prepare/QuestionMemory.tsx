import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { addInterviewQuestion, deleteInterviewQuestion } from '@/lib/prepare-api'
import {
  PREPARE_TEXT_LIMITS,
  type InterviewQuestion,
  type InterviewQuestionSource,
  type Preparation,
} from '@/lib/prepare-types'

const FILTERS: Array<{ id: 'ALL' | 'ACTUAL' | 'PRACTICE'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTUAL', label: 'Actual' },
  { id: 'PRACTICE', label: 'Practice' },
]

function matchesFilter(
  question: InterviewQuestion,
  filter: 'ALL' | 'ACTUAL' | 'PRACTICE',
) {
  if (filter === 'ALL') return true
  if (filter === 'ACTUAL') return question.source === 'ACTUAL_INTERVIEW'
  return question.source === 'PRACTICE'
}

export function QuestionMemory({
  journey,
  onChanged,
}: {
  journey: Preparation
  onChanged: () => Promise<void>
}) {
  const [filter, setFilter] = useState<'ALL' | 'ACTUAL' | 'PRACTICE'>('ALL')
  const [draft, setDraft] = useState('')
  const [stageId, setStageId] = useState(journey.nextStage?.id || journey.stages[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const questions = journey.questions ?? []
  const visible = useMemo(
    () => questions.filter((question) => matchesFilter(question, filter)),
    [questions, filter],
  )

  const grouped = useMemo(() => {
    const byStage = new Map<string, InterviewQuestion[]>()
    for (const question of visible) {
      const key = question.stageId || 'unassigned'
      const list = byStage.get(key) ?? []
      list.push(question)
      byStage.set(key, list)
    }
    return journey.stages
      .map((stage) => ({ stage, questions: byStage.get(stage.id) ?? [] }))
      .filter((group) => group.questions.length > 0)
  }, [journey.stages, visible])

  const unassigned = visible.filter((question) => !question.stageId)

  async function addQuestion() {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await addInterviewQuestion(journey.id, {
        questionText: draft.trim(),
        stageId: stageId || null,
        source: 'USER_ENTERED',
      })
      setDraft('')
      await onChanged()
      toast.success('Question saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save question')
    } finally {
      setSaving(false)
    }
  }

  async function removeQuestion(question: InterviewQuestion) {
    try {
      await deleteInterviewQuestion(journey.id, question.id)
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete question')
    }
  }

  function sourceLabel(source: InterviewQuestionSource) {
    if (source === 'ACTUAL_INTERVIEW') return 'Actual'
    if (source === 'PRACTICE') return 'Practice'
    if (source === 'AI_SUGGESTED') return 'Suggested'
    return 'Entered'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={filter === option.id ? 'default' : 'outline'}
            className="h-7 rounded-full text-xs"
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {questions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            No questions yet. Logging a round (or adding a line below) is how this journey
            remembers what they asked — so the next sprint can practice the real ones, not a
            generic bank.
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {filter === 'PRACTICE'
              ? 'Practice questions show up after Elevate is linked to a journey. Nothing is invented here.'
              : 'No questions in this filter yet.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {grouped.map(({ stage, questions: stageQuestions }) => (
            <Card key={stage.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{stage.name}</h3>
                  <Badge variant="outline">{stageQuestions.length}</Badge>
                </div>
                <ul className="space-y-2">
                  {stageQuestions.map((question) => (
                    <li
                      key={question.id}
                      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm">{question.questionText}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {sourceLabel(question.source)}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeQuestion(question)}
                        aria-label="Delete question"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
          {unassigned.length > 0 && (
            <Card>
              <CardContent className="space-y-3 py-4">
                <h3 className="font-semibold">Unassigned</h3>
                <ul className="space-y-2">
                  {unassigned.map((question) => (
                    <li
                      key={question.id}
                      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <p className="text-sm">{question.questionText}</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeQuestion(question)}
                        aria-label="Delete question"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card className="border-dashed">
        <CardContent className="space-y-3 py-4">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={PREPARE_TEXT_LIMITS.questionText}
            rows={3}
            placeholder="Add one question you remember"
            aria-label="New question"
          />
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={addQuestion} disabled={saving || !draft.trim()}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add question
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
