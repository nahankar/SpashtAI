import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type LanguageSnapshot = {
  source: 'elevate' | 'replay'
  sessions: number | null
  users: number | null
  suppressed: boolean
  medianWpm: number | null
  medianFillerRate: number | null
  medianHedgingRate: number | null
  medianSentenceLength: number | null
  medianVocabDiversity: number | null
  medianReadability: number | null
  medianCoherence: number | null
}

function shown(value: number | null, suffix = '') {
  return value == null ? 'Not recorded yet' : `${value}${suffix}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

export function LanguageAnalytics({ rows }: { rows: LanguageSnapshot[] }) {
  if (!rows.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Language signals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.map((row) => (
          <div key={row.source} className="space-y-3">
            <p className="text-sm font-medium capitalize">{row.source}{row.suppressed ? '' : ` · ${row.sessions ?? 0} analyzed sessions${row.users == null ? '' : ` · ${row.users} learners`}`}</p>
            {row.suppressed ? (
              <p className="text-sm text-muted-foreground">Hidden, fewer than 5 learners</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Median pace" value={shown(row.medianWpm, ' WPM')} />
                <Stat label="Median filler rate" value={shown(row.medianFillerRate, '%')} />
                <Stat label="Median hedging rate" value={shown(row.medianHedgingRate, '%')} />
                <Stat label="Median sentence length" value={shown(row.medianSentenceLength, ' words')} />
                <Stat label="Median vocabulary diversity" value={shown(row.medianVocabDiversity, '%')} />
                <Stat label="Median readability" value={shown(row.medianReadability)} />
                <Stat label="Median topic coherence" value={shown(row.medianCoherence)} />
              </div>
            )}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Medians come from stored speech and text analysis for the same learner cohort and date range. Filler, hedging, and vocabulary diversity are shares of words. Readability is Flesch Reading Ease. Topic coherence is similarity from 0 to 1. Phrases and transcripts stay off this dashboard.
        </p>
      </CardContent>
    </Card>
  )
}
