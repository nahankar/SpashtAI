import { memo } from 'react'
import { feedbackSummary } from './feedback-summary'
import { PENDING_FINDING, type LearnerFinding } from './useInterviewFindings'

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return <div><h4 className="font-medium">{title}</h4><ul className="list-disc space-y-0.5 pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
}

/**
 * Collapsed technical feedback directly below a learner answer in playback. A native disclosure keeps
 * keyboard and screen-reader behaviour, never moves focus, and keeps its open state while results update.
 */
export const InterviewFeedbackDisclosure = memo(function InterviewFeedbackDisclosure({ finding }: { finding: LearnerFinding | undefined }) {
  const summary = feedbackSummary(finding)
  if (!finding || !summary) return null
  const result = finding.status === 'COMPLETED' ? finding.result : null
  return <details className="group mt-1.5 w-full max-w-xl rounded-lg border bg-background/80 text-left text-sm text-foreground" data-attempt-id={finding.attemptId}>
    <summary className="cursor-pointer select-none rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {summary}
    </summary>
    <div className="space-y-2.5 border-t px-3 py-2.5">
      {PENDING_FINDING.includes(finding.status) && <p>Evaluation is in progress. Playback is unaffected; the result appears here when it is ready.</p>}
      {['FAILED', 'CANCELLED'].includes(finding.status) && <p>Technical evaluation is unavailable for this answer. No grade was invented, and your saved answer is unchanged.</p>}
      {finding.status === 'INCOMPLETE' && <p>This answer was not finished, so it was not evaluated.</p>}
      {finding.afterExample && <p className="text-orange-700 dark:text-orange-300">Given after seeing an example, so it does not establish independent recall.</p>}
      {finding.assistance === 'HINT' && <p className="text-orange-700 dark:text-orange-300">Hint-assisted answer.</p>}
      {result?.responseKind === 'REQUEST_ONLY' && <p>This response asked to repeat, skip or pause rather than answer, so there was nothing technical to assess. It says nothing about your knowledge.</p>}
      {result?.responseKind === 'DONT_KNOW' && <p>You said you did not know this one, so there was nothing technical to assess.</p>}
      {result && <>
        <List title="What was correct" items={result.strengths} />
        <List title="Missing core concepts" items={result.gaps} />
        <List title="Misconceptions" items={result.misconceptions} />
        <List title="Uncertain" items={result.uncertainty} />
        {result.guidance && <div><h4 className="font-medium">How to improve</h4><p>{result.guidance}</p></div>}
      </>}
    </div>
  </details>
})
