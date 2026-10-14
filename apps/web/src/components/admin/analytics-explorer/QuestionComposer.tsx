import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const EXAMPLES = [
  'How many learners used Replay in the last 30 days?',
  'Compare Elevate usage for men and women',
  'What is the median speaking pace on Elevate for learners over 40?',
  'Who has never used Interviews?',
] as const

export function QuestionComposer({
  question,
  asking,
  onQuestion,
  onAsk,
}: {
  question: string
  asking: boolean
  onQuestion: (value: string) => void
  onAsk: (question: string) => void
}) {
  const trimmed = question.trim()

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="h-5 w-5 text-primary" />
          Ask about learners
        </CardTitle>
        <CardDescription>
          A saved plan answers the question. Pinned refresh runs that plan again and does not call the model.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed && !asking) onAsk(trimmed)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="analytics-question">Question</Label>
            <Textarea
              id="analytics-question"
              value={question}
              maxLength={1000}
              rows={3}
              disabled={asking}
              placeholder="Example: Compare Replay usage for learners over 40"
              onChange={(event) => onQuestion(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{question.length}/1000</p>
              <Button type="submit" disabled={!trimmed || asking}>
                {asking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {asking ? 'Asking...' : 'Ask'}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Examples</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((example) => (
                <Button
                  key={example}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                  disabled={asking}
                  onClick={() => {
                    onQuestion(example)
                    onAsk(example)
                  }}
                >
                  {example}
                </Button>
              ))}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
