import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button, type ButtonProps } from '@/components/ui/button'
import { plausibleAcoustics } from '@/lib/acoustics'
import { paceTrendTurns, MIN_PACE_TREND_TURNS } from '@/lib/pace'
import {
  DeliveryEvidenceOverviewView,
  DeliveryMomentsPlaybackView,
} from './DeliveryMoments'
import type { DeliveryMomentResponse } from './deliveryMomentsData'
import { experimentalMoment } from './delivery/fixtures'

const noAlignment: DeliveryMomentResponse = {
  status: {
    enabled: true,
    state: 'suppressed',
    reason: 'validated_word_alignment_required',
    validTurnCount: 0,
    momentCount: 0,
  },
  moments: [],
}

const withMoment: DeliveryMomentResponse = {
  status: { enabled: true, state: 'available', reason: null, validTurnCount: 3, momentCount: 1 },
  moments: [
    {
      id: 'm1',
      kind: 'sentence_boundary_pause',
      polarity: 'strength',
      clipStartSec: 83.2,
      clipEndSec: 88.4,
      pauseSeconds: 0.9,
      confidence: 0.9,
      observation: 'You paused for 0.9s after finishing a sentence.',
      interpretation: 'The pause separated two ideas.',
      retry: 'Keep a short pause after your key point.',
    },
  ],
  deliveryEvidence: { state: 'ready', moments: [experimentalMoment] },
}

function findButtons(node: ReactNode, found: ReactElement<ButtonProps>[] = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findButtons(child, found))
    return found
  }
  if (!isValidElement<ButtonProps & { children?: ReactNode }>(node)) return found
  if (node.type === Button) found.push(node)
  findButtons(node.props.children, found)
  return found
}

describe('Playback delivery moments', () => {
  it('shows a compact one-line notice when word timing is unverified', () => {
    const html = renderToStaticMarkup(<DeliveryMomentsPlaybackView data={noAlignment} />)
    expect(html).toContain(
      'Delivery moments unavailable for this recording — verified word timing is required to identify pause placement reliably.',
    )
    expect(html).toContain('role="status"')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('Experimental recording measurements')
  })

  it('renders playable verified moments and keeps experimental measurements collapsed', () => {
    const html = renderToStaticMarkup(
      <DeliveryMomentsPlaybackView data={withMoment} onPlayMoment={() => {}} />,
    )
    expect(html).toContain('Verified · word-aligned')
    expect(html).toContain('aria-label="Hear this moment at 1:23"')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('Experimental recording measurements')
    expect(html).toContain('Measurement confidence: limited')
  })

  it('plays the exact clip bounds and preserves gaps', () => {
    const onPlayMoment = vi.fn()
    const tree = DeliveryMomentsPlaybackView({ data: withMoment, onPlayMoment })
    const hear = findButtons(tree).find((button) =>
      String(button.props['aria-label']).startsWith('Hear this moment'),
    )
    expect(hear).toBeDefined()
    hear!.props.onClick?.({} as never)
    expect(onPlayMoment).toHaveBeenCalledWith(83.2, 88.4, true)
  })

  it('renders nothing when the feature is disabled', () => {
    const html = renderToStaticMarkup(
      <DeliveryMomentsPlaybackView
        data={{ ...noAlignment, status: { ...noAlignment.status, enabled: false } }}
      />,
    )
    expect(html).toBe('')
  })
})

describe('Session Analytics delivery summary', () => {
  it('explains missing alignment while confirming available measurements', () => {
    const html = renderToStaticMarkup(
      <DeliveryEvidenceOverviewView data={noAlignment} measurementsAvailable />,
    )
    expect(html).toContain('Recording measurements are available.')
    expect(html).toContain(
      'Verified delivery moments are not available because word-level alignment could not be confirmed.',
    )
    expect(html).toContain('Why this matters')
    expect(html).not.toContain('Open in Playback')
  })

  it('counts verified moments and links to Playback', () => {
    const onOpenPlayback = vi.fn()
    const html = renderToStaticMarkup(
      <DeliveryEvidenceOverviewView
        data={withMoment}
        measurementsAvailable={false}
        onOpenPlayback={onOpenPlayback}
      />,
    )
    expect(html).toContain('1 verified delivery moment')
    expect(html).toContain('Open in Playback')
    const button = findButtons(
      DeliveryEvidenceOverviewView({ data: withMoment, measurementsAvailable: false, onOpenPlayback }),
    )[0]
    button.props.onClick?.({} as never)
    expect(onOpenPlayback).toHaveBeenCalledTimes(1)
  })

  it('never uses judgmental delivery language', () => {
    const html = [
      renderToStaticMarkup(<DeliveryEvidenceOverviewView data={noAlignment} measurementsAvailable />),
      renderToStaticMarkup(<DeliveryMomentsPlaybackView data={withMoment} onPlayMoment={() => {}} />),
    ].join('')
    expect(html).not.toMatch(/\b(?:confident|strained|monotone|raised voice|good voice|bad voice)\b|0\s*[–-]\s*10/i)
  })
})

describe('acoustic plausibility', () => {
  it('withholds the legacy -166 dB harmonicity and octave-inflated pitch spread', () => {
    const result = plausibleAcoustics({
      mean_f0_hz: 156.1,
      f0_std_hz: 145.8,
      harmonicity_mean_db: -166.2,
    })
    expect(result.meanF0Hz).toBe(156.1)
    expect(result.f0SpreadHz).toBeNull()
    expect(result.harmonicityDb).toBeNull()
    expect(result.withheld).toBe(true)
  })

  it('keeps plausible speech measurements', () => {
    expect(
      plausibleAcoustics({ mean_f0_hz: 150, f0_std_hz: 25, harmonicity_mean_db: 12 }),
    ).toEqual({ meanF0Hz: 150, f0SpreadHz: 25, harmonicityDb: 12, withheld: false })
  })
})

describe('pace trend qualification', () => {
  const qualified = (index: number) => ({
    role: 'user',
    turnIndex: index,
    metrics: { word_count: 20, wpm: 140, speaking_seconds: 8, pace_source: 'word_timestamps' },
  })
  const fragment = {
    role: 'user',
    turnIndex: 99,
    metrics: { word_count: 1, wpm: 90, speaking_seconds: 0.7, pace_source: 'word_timestamps' },
  }

  it('requires verified session pace', () => {
    expect(paceTrendTurns([qualified(1), qualified(2), qualified(3)], false)).toEqual([])
  })

  it(`requires ${MIN_PACE_TREND_TURNS} qualified turns and excludes fragments`, () => {
    expect(paceTrendTurns([qualified(1), qualified(2), fragment], true)).toEqual([])
    expect(
      paceTrendTurns([qualified(1), fragment, qualified(2), qualified(3)], true).map(
        (turn) => turn.turnIndex,
      ),
    ).toEqual([1, 2, 3])
  })
})
