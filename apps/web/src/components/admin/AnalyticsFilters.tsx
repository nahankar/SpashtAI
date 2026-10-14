import { useState } from 'react'
import { AGE_BANDS, GENDERS, type AnalyticsQuery } from '@/lib/adminAnalytics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function AnalyticsFilters({
  query,
  onChange,
  showPulse = false,
}: {
  query: AnalyticsQuery
  onChange: (next: AnalyticsQuery) => void
  showPulse?: boolean
}) {
  const [place, setPlace] = useState('')
  const [region, setRegion] = useState('')

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {[7, 30, 90].map((days) => (
          <Button key={days} type="button" size="sm" variant={query.days === days ? 'default' : 'outline'} onClick={() => onChange({ ...query, days })}>
            {days} days
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {GENDERS.map((gender) => (
          <Button key={gender.id} type="button" size="sm" variant={query.gender.includes(gender.id) ? 'default' : 'outline'} onClick={() => onChange({ ...query, gender: toggle(query.gender, gender.id) })}>
            {gender.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {AGE_BANDS.map((band) => (
          <Button key={band.id} type="button" size="sm" variant={query.ageBand.includes(band.id) ? 'default' : 'outline'} onClick={() => onChange({ ...query, ageBand: toggle(query.ageBand, band.id) })}>
            {band.label}
          </Button>
        ))}
      </div>
      {showPulse && (
        <div className="flex flex-wrap gap-2">
          {['elevate', 'replay'].map((source) => (
            <Button key={source} type="button" size="sm" variant={query.source.includes(source) ? 'default' : 'outline'} onClick={() => onChange({ ...query, source: toggle(query.source, source) })}>
              {source}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (place.trim()) { onChange({ ...query, city: [...query.city, place.trim()] }); setPlace('') } }}>
          <Input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="City" aria-label="City" />
          <Button type="submit" variant="outline">Add</Button>
        </form>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (region.trim()) { onChange({ ...query, state: [...query.state, region.trim()] }); setRegion('') } }}>
          <Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="State" aria-label="State" />
          <Button type="submit" variant="outline">Add</Button>
        </form>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {[...query.city, ...query.state].map((value) => (
          <button key={value} type="button" className="rounded-full bg-muted px-2 py-1" onClick={() => onChange({
            ...query,
            city: query.city.filter((item) => item !== value),
            state: query.state.filter((item) => item !== value),
          })}>
            {value} ×
          </button>
        ))}
      </div>
    </div>
  )
}
