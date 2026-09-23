import { isValidElement, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button, type ButtonProps } from '@/components/ui/button'
import { DeliveryEvidenceSummary } from './DeliveryEvidenceSummary'
import { DeliveryMomentCard } from './DeliveryMomentCard'
import { DeliveryTrendChart } from './DeliveryTrendChart'
import {
  audioLevelMoment,
  deliveryFixtures,
  experimentalMoment,
  pitchMoment,
  unavailableMoment,
} from './fixtures'
import type { DeliveryMoment } from './contract'

const onHearEvidence = vi.fn()

function markup(moment: DeliveryMoment) {
  return renderToStaticMarkup(
    <DeliveryMomentCard moment={moment} onHearEvidence={onHearEvidence} />,
  )
}

function playbackButton(node: ReactNode): ReactElement<ButtonProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const button = playbackButton(child)
      if (button) return button
    }
    return undefined
  }
  if (!isValidElement<ButtonProps & { children?: ReactNode }>(node)) return undefined
  if (node.type === Button) return node
  return playbackButton(node.props.children)
}

describe('delivery evidence prototype', () => {
  it('shows measured units, provenance and capture caveats without experimental judgments', () => {
    const html = markup(experimentalMoment)
    expect(html).toContain('Moment at 1:12.4')
    expect(html).toContain('Clip duration: 3.2 seconds')
    expect(html).toContain('Raw observation: Pause duration: 0.8 seconds')
    expect(html).toContain('Verified observation')
    expect(html).toContain('Experimental · uncalibrated')
    expect(html).toContain('Evidence quality: verified — Word-aligned recording')
    expect(html).toContain('Audio input signature: server-signature-1; analyzer: delivery-raw-v1')
    expect(html).toContain('Browser-reported capture processing: AGC on; noise suppression unknown')
    expect(html).toContain('AGC can change recorded levels; noise suppression can remove signal detail.')
    expect(html).not.toMatch(/\b(?:good|bad|confident|strained|monotone|raised voice|health|personality)\b|0\s*[–-]\s*10/i)
    expect(markup(audioLevelMoment)).toContain('Recorded intensity: 62.5 dB')
    expect(markup(pitchMoment)).toContain('184.3 Hz')
    expect(markup({
      ...pitchMoment,
      evidence: {
        quality: 'verified',
        method: 'validated_acoustic_extraction',
        measurement: { metric: 'f0_spread', value: 0, unit: 'Hz' },
      },
    })).toContain('Fundamental-frequency spread: 0 Hz')
    const shortMoment: DeliveryMoment = {
      ...experimentalMoment,
      clip: { ...experimentalMoment.clip, startSeconds: 72.45, durationSeconds: 0.04 },
      evidence: {
        ...experimentalMoment.evidence,
        quality: 'verified',
        method: 'word_aligned_recording',
        measurement: { metric: 'pause_duration', value: 0.04, unit: 'seconds' },
      },
    }
    expect(markup(shortMoment)).toContain('Moment at 1:12.45')
    expect(markup(shortMoment)).toContain('Clip duration: 0.04 seconds')
    expect(markup(shortMoment)).toContain('Pause duration: 0.04 seconds')
  })

  it('shows insufficient evidence without inventing a measurement or enabling playback', () => {
    const html = markup(unavailableMoment)
    expect(html).toContain('Insufficient evidence')
    expect(html).toContain('Raw observation: unavailable')
    expect(html).toContain('Recording segment missing')
    expect(html).toContain('Clip duration: 2.5 seconds')
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toContain('Recording clip unavailable; playback disabled.')
    expect(html).not.toContain('Calibrated</span>')
  })

  it('does not render calibration from an unvalidated browser payload', () => {
    const forged = { ...pitchMoment, calibration: { state: 'experimental' as const } }
    Object.assign(forged.calibration, { state: 'calibrated', artifactVersion: 'unvalidated' })
    const html = markup(forged)
    expect(html).toContain('Experimental · uncalibrated')
    expect(html).not.toContain('>Calibrated</span>')
    expect(html).not.toContain('Calibration artifact:')
  })

  it('disables playback when no player is supplied', () => {
    const html = renderToStaticMarkup(<DeliveryMomentCard moment={experimentalMoment} />)
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toContain('Playback is unavailable in this view.')
  })

  it('passes exact clip bounds and id to the playback handler', () => {
    const handler = vi.fn()
    const element = DeliveryMomentCard({ moment: experimentalMoment, onHearEvidence: handler })
    const button = playbackButton(element)
    expect(button).toBeDefined()
    button?.props.onClick?.({} as MouseEvent<HTMLButtonElement>)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].momentId).toBe('pause-1')
    expect(handler.mock.calls[0][0].startSeconds).toBe(72.4)
    expect(handler.mock.calls[0][0].endSeconds).toBeCloseTo(75.6)
    expect(handler.mock.calls[0][0].includeGaps).toBe(true)
  })

  it('uses semantic playback and chart labels and excludes insufficient samples', () => {
    const html = markup(experimentalMoment)
    expect(html).toMatch(/<button[^>]*type="button"/)
    expect(html).toContain('aria-label="Hear evidence for moment at 1:12.4"')

    const chart = renderToStaticMarkup(
      <DeliveryTrendChart
        metric="pause_duration"
        moments={[experimentalMoment, unavailableMoment, { ...experimentalMoment, id: 'pause-2', clip: { ...experimentalMoment.clip, startSeconds: 150 } }]}
      />,
    )
    expect(chart).toContain('role="img"')
    expect(chart).toContain('2 verified samples; gaps are not interpolated')
    expect(chart.match(/<circle /g)).toHaveLength(2)
    expect(chart).toContain('<caption>Pause duration samples</caption>')
    expect(chart).toContain('<th scope="col">Raw measurement</th>')
    expect(chart).toContain('0.8 seconds')
    const mixed = renderToStaticMarkup(
      <DeliveryEvidenceSummary
        data={{ state: 'ready', moments: [
          audioLevelMoment,
          {
            ...audioLevelMoment,
            id: 'level-5',
            clip: { ...audioLevelMoment.clip, startSeconds: 150 },
            capture: { agc: 'off', noiseSuppression: 'on' },
            captureFingerprint: 'agc:off|noise:on',
          },
        ] }}
        onHearEvidence={onHearEvidence}
        trendMetric="intensity"
      />,
    )
    expect(mixed).toContain('Trend unavailable: capture processing changed during this recording.')
    expect(mixed).not.toContain('<circle')
  })

  it('surfaces invalid evidence data rather than displaying or plotting it as verified', () => {
    const invalid: DeliveryMoment = {
      ...experimentalMoment,
      id: 'invalid-pause',
      evidence: {
        quality: 'verified',
        method: 'word_aligned_recording',
        measurement: { metric: 'pause_duration', value: NaN, unit: 'seconds' },
      },
    }
    const html = markup(invalid)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Raw measurement is missing or outside its physical unit range.')
    expect(html).not.toContain('Verified observation')
    expect(html).not.toContain('<button')

    const chart = renderToStaticMarkup(
      <DeliveryTrendChart metric="pause_duration" moments={[experimentalMoment, invalid]} />,
    )
    expect(chart).toContain('role="alert"')
    expect(chart).not.toContain('<circle')

    const summary = renderToStaticMarkup(
      <DeliveryEvidenceSummary
        data={{ state: 'ready', moments: [experimentalMoment, invalid] }}
        onHearEvidence={onHearEvidence}
      />,
    )
    expect(summary).toContain('1 delivery moment contains invalid data.')
    expect(summary).toContain('1 verified observation; 0 with insufficient evidence')
    expect(markup({ ...experimentalMoment, clip: { ...experimentalMoment.clip, durationSeconds: 0 } })).toContain('role="alert"')
    expect(markup({ ...experimentalMoment, provenance: { ...experimentalMoment.provenance, audioInputSignature: ' ' } })).toContain('role="alert"')
  })

  it('renders empty, pending, unavailable and error states explicitly', () => {
    const expected = {
      empty: 'No delivery moments were found',
      pending: 'Delivery evidence is being prepared',
      unavailable: 'Recording was not retained.',
      insufficient: 'too little usable voiced signal',
      error: 'Evidence processing failed.',
    }
    for (const [key, text] of Object.entries(expected)) {
      const html = renderToStaticMarkup(
        <DeliveryEvidenceSummary data={deliveryFixtures[key]} onHearEvidence={onHearEvidence} />,
      )
      expect(html).toContain('aria-label="Delivery evidence"')
      expect(html).toContain(text)
      expect(html).not.toContain('Verified observation')
      if (key === 'error') expect(html).toContain('role="alert"')
      if (key === 'pending') expect(html).toContain('role="status"')
    }
    const ready = renderToStaticMarkup(
      <DeliveryEvidenceSummary data={deliveryFixtures.ready} onHearEvidence={onHearEvidence} />,
    )
    expect(ready).toContain('3 verified observations; 1 with insufficient evidence; 3 experimental and uncalibrated.')
  })
})
