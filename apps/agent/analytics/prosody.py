"""
Acoustic prosody analysis for the v2 delivery metrics.

Runs Praat (via parselmouth) for pitch / energy / voice-quality and ffmpeg
`silencedetect` for pause statistics on the user's mic recording. Returns
0–10 scores ready for the Delivery dashboard, plus the raw measurements.

This is intentionally Gentle-free: the recording is the user's track only, so
pauses are short within-speech silences (long silences are the coach replying
and are excluded), and pitch/energy/HNR come straight from the waveform.
"""

from __future__ import annotations

import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger("prosody")

# Speaking pauses sit between these bounds. Below = micro-gaps/word boundaries;
# above = the coach's turn (silent on the user track), not a speaking pause.
_MIN_PAUSE_SEC = 0.3
_MAX_PAUSE_SEC = 3.0


def _clamp(v: float, lo: float = 0.0, hi: float = 10.0) -> float:
    return max(lo, min(hi, v))


def _to_wav(audio_path: str) -> tuple[str, Optional[str]]:
    """Return a 16 kHz mono WAV path, converting if needed. Second element is a
    temp path to delete afterwards (None when the input was already usable)."""
    if audio_path.lower().endswith(".wav"):
        return audio_path, None
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1",
         "-acodec", "pcm_s16le", tmp.name],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True,
    )
    return tmp.name, tmp.name


def _detect_pauses(audio_path: str) -> tuple[int, float]:
    """Count speaking pauses + mean duration via ffmpeg silencedetect."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", audio_path,
             "-af", "silencedetect=noise=-30dB:d=%.2f" % _MIN_PAUSE_SEC,
             "-f", "null", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
        )
        text = proc.stderr.decode("utf-8", "ignore")
    except Exception as e:  # noqa: BLE001
        logger.warning("silencedetect failed: %s", e)
        return 0, 0.0

    durations = [float(m) for m in re.findall(r"silence_duration:\s*([0-9.]+)", text)]
    pauses = [d for d in durations if _MIN_PAUSE_SEC <= d <= _MAX_PAUSE_SEC]
    if not pauses:
        return 0, 0.0
    return len(pauses), sum(pauses) / len(pauses)


def analyze_prosody(audio_path: str) -> Optional[dict]:
    """Compute normalized (0–10) prosody scores + raw stats for a recording."""
    if not audio_path or not Path(audio_path).exists():
        logger.warning("prosody: audio not found at %s", audio_path)
        return None

    try:
        import numpy as np
        import parselmouth
    except ImportError as e:  # noqa: BLE001
        logger.warning("prosody: parselmouth/numpy unavailable (%s)", e)
        return None

    wav_path, cleanup = _to_wav(audio_path)
    try:
        sound = parselmouth.Sound(wav_path)

        # Constrain f0 to a human speech band so the long quiet stretches (coach
        # turns are silent on this track) don't inject octave-doubling noise.
        pitch = sound.to_pitch(pitch_floor=75.0, pitch_ceiling=400.0)
        freqs = pitch.selected_array["frequency"]
        freqs = freqs[freqs > 0]
        # Drop residual octave jumps: keep frames near the speaker's median f0.
        if len(freqs):
            med = float(np.median(freqs))
            freqs = freqs[(freqs >= med * 0.6) & (freqs <= med * 1.7)]
        pitch_std = float(np.std(freqs)) if len(freqs) else 0.0
        pitch_mean = float(np.mean(freqs)) if len(freqs) else 0.0

        # Energy stability must be measured over SPEECH, not the silent gaps —
        # otherwise the speech-vs-silence dB swing dominates. Keep only frames
        # within 25 dB of the loudest (i.e. the person actually talking).
        intensity = sound.to_intensity()
        ivals = intensity.values.flatten()
        ivals = ivals[np.isfinite(ivals)]
        if len(ivals):
            ivals = ivals[ivals >= float(np.max(ivals)) - 25.0]
        intensity_std = float(np.std(ivals)) if len(ivals) else 0.0

        harmonicity = sound.to_harmonicity()
        hvals = harmonicity.values.flatten()
        hvals = hvals[np.isfinite(hvals)]
        hvals = hvals[hvals > -100]  # Praat marks unvoiced frames as ~ -200
        hnr_mean = float(np.mean(hvals)) if len(hvals) else 0.0

        pause_count, mean_pause = _detect_pauses(wav_path)

        # Normalize to 0–10:
        #  pitch: lively speech has ~40–60 Hz f0 std; monotone < 15 Hz.
        #  energy: smaller dB spread = steadier; ~2 dB ⇒ 10, ~12 dB ⇒ 0.
        #  voice quality: harmonics-to-noise ratio, ~20 dB clean ⇒ 10.
        pitch_variation = _clamp(pitch_std / 5.0)
        energy_stability = _clamp(10.0 - max(intensity_std - 2.0, 0.0))
        voice_quality = _clamp(hnr_mean / 2.0)

        return {
            "pitchVariation": round(pitch_variation, 1),
            "energyStability": round(energy_stability, 1),
            "voiceQuality": round(voice_quality, 1),
            "pauseCount": pause_count,
            "meanPauseDuration": round(mean_pause, 2),
            "raw": {
                "pitchStdHz": round(pitch_std, 1),
                "pitchMeanHz": round(pitch_mean, 1),
                "intensityStdDb": round(intensity_std, 1),
                "hnrDb": round(hnr_mean, 1),
            },
        }
    except Exception as e:  # noqa: BLE001
        logger.error("prosody analysis failed: %s", e, exc_info=True)
        return None
    finally:
        if cleanup:
            Path(cleanup).unlink(missing_ok=True)
