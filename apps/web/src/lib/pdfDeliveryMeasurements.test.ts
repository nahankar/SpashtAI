import { describe, expect, it } from 'vitest'
import { buildExperimentalMeasurementsSection, PDF_MEASUREMENTS_SECTION } from './pdfDeliveryMeasurements'

const BANNED = /experimental index|voice quality|pitch variation|energy stability|monotone|confident|strained|good|bad|\/10/i

describe('buildExperimentalMeasurementsSection', () => {
  it('reports raw units only, with no 0–10 indices, tones, or score bars', () => {
    const section = buildExperimentalMeasurementsSection({
      prosody: {
        pauseCount: 4,
        meanPauseDuration: 0.82,
        raw: { pitchMeanHz: 128.4, pitchStdHz: 22.6, hnrDb: 11.27 },
      },
    })

    expect(section?.section).toBe(PDF_MEASUREMENTS_SECTION)
    expect(section?.description).toContain('Measurement confidence: limited')
    expect(section?.items.map((i) => [i.label, i.value, i.unit])).toEqual([
      ['Average pitch', '128', 'Hz'],
      ['Pitch movement', '±23', 'Hz'],
      ['Harmonicity', '11.3', 'dB'],
      ['Pauses within your turns', '4', undefined],
    ])
    for (const item of section!.items) {
      expect(item.score).toBeUndefined()
      expect(item.tone).toBeUndefined()
      expect(`${item.label} ${item.hint ?? ''}`).not.toMatch(BANNED)
    }
    expect(section?.items[3].hint).toContain('0.82 s')
  })

  it('withholds implausible legacy values such as -166 dB harmonicity', () => {
    const section = buildExperimentalMeasurementsSection({
      prosody: { pauseCount: 0, raw: { pitchMeanHz: 150, pitchStdHz: 145.8, hnrDb: -166.2 } },
    })
    expect(section?.items.map((i) => i.label)).toEqual(['Average pitch'])
  })

  it('prefers aligned delivery evidence over signal prosody, matching Session Analytics', () => {
    const section = buildExperimentalMeasurementsSection({
      prosody: { pauseCount: 9, raw: { pitchMeanHz: 300, pitchStdHz: 10, hnrDb: 5 } },
      alignedDelivery: {
        pause_count: 2,
        mean_pause_duration: 1.1,
        delivery_evidence: {
          acoustic: { raw_measurements: { mean_f0_hz: 180, f0_std_hz: 20, harmonicity_mean_db: 14 } },
        },
      },
    })
    expect(section?.items.map((i) => i.value)).toEqual(['180', '±20', '14.0', '2'])
  })

  it('omits the section when nothing plausible was measured', () => {
    expect(
      buildExperimentalMeasurementsSection({
        prosody: { pauseCount: 0, raw: { pitchMeanHz: 0, pitchStdHz: 0, hnrDb: -200 } },
      }),
    ).toBeNull()
    expect(buildExperimentalMeasurementsSection({ prosody: null })).toBeNull()
  })
})
