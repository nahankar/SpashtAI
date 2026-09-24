import { plausibleAcoustics, type RawAcousticInput } from '@/lib/acoustics'
import { MEASUREMENT_CONFIDENCE_NOTE } from '@/components/analytics/deliveryMomentsData'
import type { SessionReport } from '@/lib/generate-session-pdf'

type MetricSection = NonNullable<SessionReport['metrics']>[number]

export interface PdfProsodyInput {
  pauseCount?: number | null
  meanPauseDuration?: number | null
  raw?: {
    pitchMeanHz?: number | null
    pitchStdHz?: number | null
    hnrDb?: number | null
  } | null
}

export interface PdfAlignedDeliveryInput {
  pause_count?: number | null
  mean_pause_duration?: number | null
  delivery_evidence?: {
    acoustic?: { raw_measurements?: RawAcousticInput | null } | null
  } | null
}

export const PDF_MEASUREMENTS_SECTION = 'Experimental recording measurements'

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Builds the PDF's experimental measurement section from the same sources and
 * plausibility checks as Session Analytics. It carries raw units only (Hz, dB,
 * seconds) — no 0–10 indices, verdict tones, or score bars — and is omitted
 * when nothing plausible was measured.
 */
export function buildExperimentalMeasurementsSection(input: {
  prosody?: PdfProsodyInput | null
  alignedDelivery?: PdfAlignedDeliveryInput | null
}): MetricSection | null {
  const { prosody, alignedDelivery } = input
  const rawMeasurements: RawAcousticInput | null =
    alignedDelivery?.delivery_evidence?.acoustic?.raw_measurements ??
    (prosody?.raw
      ? {
          mean_f0_hz: prosody.raw.pitchMeanHz,
          f0_std_hz: prosody.raw.pitchStdHz,
          harmonicity_mean_db: prosody.raw.hnrDb,
        }
      : null)
  const acoustics = plausibleAcoustics(rawMeasurements)

  const items: MetricSection['items'] = []
  if (acoustics.meanF0Hz != null) {
    items.push({
      label: 'Average pitch',
      value: acoustics.meanF0Hz.toFixed(0),
      unit: 'Hz',
      hint: 'How high or low your voice sat on average.',
    })
  }
  if (acoustics.f0SpreadHz != null) {
    items.push({
      label: 'Pitch movement',
      value: `\u00b1${acoustics.f0SpreadHz.toFixed(0)}`,
      unit: 'Hz',
      hint: 'Typical spread around your average pitch.',
    })
  }
  if (acoustics.harmonicityDb != null) {
    items.push({
      label: 'Harmonicity',
      value: acoustics.harmonicityDb.toFixed(1),
      unit: 'dB',
      hint: 'Tone-to-noise; mic and room affect it.',
    })
  }

  const pauseCount = finite(alignedDelivery?.pause_count) ?? finite(prosody?.pauseCount)
  const meanPause =
    finite(alignedDelivery?.mean_pause_duration) ?? finite(prosody?.meanPauseDuration)
  if (pauseCount != null && pauseCount > 0) {
    items.push({
      label: 'Pauses within your turns',
      value: String(Math.round(pauseCount)),
      hint:
        meanPause != null && meanPause > 0
          ? `Avg ${meanPause.toFixed(2)} s; between-turn gaps excluded.`
          : 'Between-turn gaps excluded.',
    })
  }

  if (items.length === 0) return null

  return {
    section: PDF_MEASUREMENTS_SECTION,
    description: `${MEASUREMENT_CONFIDENCE_NOTE} Factual values, not coaching.`,
    items,
  }
}
