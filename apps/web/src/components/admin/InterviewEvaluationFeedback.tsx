import { labels, type Assessment } from '@/lib/interview-evaluator'
export function InterviewEvaluationFeedback({ result }: { result: NonNullable<Assessment['result']> }) {
  return <>
    {result.validationNotes?.map((note, i) => <p key={i} className="text-sm text-muted-foreground">{note}</p>)}
    <div className="grid gap-3 sm:grid-cols-3">{result.criteria.map(c => <div key={c.criterion} className="rounded-lg border p-3 space-y-2"><h3 className="font-medium">{labels[c.criterion]}</h3><p className="text-sm">{labels[c.finding]}</p><p className="text-sm text-muted-foreground">{c.explanation}</p>{c.evidence.map((quote, i) => <blockquote key={i} className="border-l-2 pl-2 text-sm whitespace-pre-wrap">“{quote}”</blockquote>)}</div>)}</div>
    {([['What was correct', result.strengths], ['Missing concepts', result.gaps], ['Misconceptions', result.misconceptions], ['Uncertainties to review', result.uncertainty]] as const).map(([title, items]) => items.length > 0 && <div key={title}><h3 className="font-medium">{title}</h3><ul className="list-disc pl-5 text-sm mt-2 space-y-1">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
    <p className="text-sm">{result.guidance}</p>
    <div className="rounded-lg bg-muted p-4 space-y-2"><h3 className="font-medium">Suggested next step · {labels[result.next.action]}</h3><p>{result.next.questionText ?? 'No active question from a different topic is available in this track. Add or activate one before continuing.'}</p>{result.next.topic && <p className="text-xs text-muted-foreground">Topic: {result.next.topic}</p>}{result.next.needsReview && <p className="text-xs text-muted-foreground">AI-generated follow-up proposal · Review its relevance and difficulty.</p>}</div>
  </>
}
