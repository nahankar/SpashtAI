/**
 * Plausibility checks for experimental acoustic measurements.
 *
 * Older analyses averaged Praat's unvoiced markers (about -200 dB) and pitch
 * octave errors into the stored values, producing numbers such as -166 dB
 * harmonicity or a pitch spread almost equal to the mean pitch. Those values
 * describe the analysis failing, not the speaker, so they are withheld.
 */

export interface RawAcousticInput {
  mean_f0_hz?: number | null
  f0_std_hz?: number | null
  harmonicity_mean_db?: number | null
}

export interface PlausibleAcoustics {
  meanF0Hz: number | null
  f0SpreadHz: number | null
  harmonicityDb: number | null
  /** True when at least one supplied value was withheld as implausible. */
  withheld: boolean
}

const MEAN_F0_HZ = { min: 50, max: 500 }
const HARMONICITY_DB = { min: -10, max: 40 }
const MAX_SPREAD_TO_MEAN = 0.5

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function plausibleAcoustics(raw: RawAcousticInput | null | undefined): PlausibleAcoustics {
  const mean = finite(raw?.mean_f0_hz)
  const spread = finite(raw?.f0_std_hz)
  const hnr = finite(raw?.harmonicity_mean_db)

  const meanF0Hz = mean != null && mean >= MEAN_F0_HZ.min && mean <= MEAN_F0_HZ.max ? mean : null
  const f0SpreadHz =
    spread != null && spread > 0 && meanF0Hz != null && spread <= meanF0Hz * MAX_SPREAD_TO_MEAN
      ? spread
      : null
  const harmonicityDb =
    hnr != null && hnr >= HARMONICITY_DB.min && hnr <= HARMONICITY_DB.max ? hnr : null

  return {
    meanF0Hz,
    f0SpreadHz,
    harmonicityDb,
    withheld:
      (mean != null && meanF0Hz == null) ||
      (spread != null && f0SpreadHz == null) ||
      (hnr != null && harmonicityDb == null),
  }
}

export function hasPlausibleAcoustics(value: PlausibleAcoustics): boolean {
  return value.meanF0Hz != null || value.f0SpreadHz != null || value.harmonicityDb != null
}
