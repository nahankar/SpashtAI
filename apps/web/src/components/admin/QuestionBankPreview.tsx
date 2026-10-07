import type { BankPreview } from '@/lib/interview-bank'
export function QuestionBankPreview({ data }: { data: BankPreview }) {
  const preview = data.preview
  return <section className="rounded-xl border p-6 space-y-4 bg-muted/20">
    <h2 className="font-semibold">Learner preview · {data.status} · Admin preview only</h2>
    <h3 className="text-lg font-medium whitespace-pre-wrap">{preview.questionText}</h3>
    <p className="text-sm">Expected depth: {preview.expectedDepth}</p>
    <ul className="list-disc pl-5">{preview.criteria.map(c => <li key={c.id}>{c.label}</li>)}</ul>
    <div><h3 className="font-medium">Explanation</h3><p className="whitespace-pre-wrap mt-1">{preview.explanation}</p></div>
    <div><h3 className="font-medium">Example answer</h3><p className="whitespace-pre-wrap mt-1">{preview.exampleAnswer}</p></div>
  </section>
}
