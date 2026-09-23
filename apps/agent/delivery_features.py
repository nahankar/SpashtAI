"""Raw, replay-clock acoustic observations for verified user-turn windows.

This module is intentionally standalone.  It does not produce coaching labels,
scores, diagnoses, or personality/emotion inferences.  Integration code must
provide the server-issued audio signature and verified alignment provenance.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Literal, Mapping, Sequence

import numpy as np

EvidenceState = Literal["available", "insufficient_evidence", "suppressed"]
TimingOrigin = Literal["actual", "forced_alignment", "synthetic", "unknown"]
AlignmentClock = Literal["merged", "segment"]

_VERIFIED_ORIGINS = {"actual", "forced_alignment"}
_MIN_ALIGNMENT_COVERAGE = 0.95
_CLIP_CONTEXT_SEC = 0.8


@dataclass(frozen=True)
class SegmentClock:
    """Maps one segment-local clock onto Replay's merged-audio clock."""

    segment_id: str
    replay_offset_sec: float
    duration_sec: float
    audio_available: bool = True
    capture_metadata: CaptureMetadata | None = None


@dataclass(frozen=True)
class AlignedWord:
    word: str
    start_sec: float
    end_sec: float
    turn_id: str
    timing_origin: TimingOrigin
    segment_id: str | None = None
    clock: AlignmentClock = "merged"


@dataclass(frozen=True)
class TurnWindow:
    """One user turn; start/end and words share the declared clock."""

    turn_id: str
    start_sec: float
    end_sec: float
    words: tuple[AlignedWord, ...]
    alignment_coverage: float
    segment_id: str | None = None
    clock: AlignmentClock = "merged"


@dataclass(frozen=True)
class CaptureMetadata:
    automatic_gain_control: bool | None = None
    noise_suppression: bool | None = None
    echo_cancellation: bool | None = None
    voice_isolation: bool | None = None
    microphone_label: str | None = None
    device_id: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DeliveryFeatureRequest:
    audio_path: str
    audio_input_signature: str
    expected_audio_input_signature: str
    analyzer_version: str
    turns: tuple[TurnWindow, ...]
    segments: tuple[SegmentClock, ...] = ()
    complete_segment_audio: bool = True
    capture_metadata: CaptureMetadata = field(default_factory=CaptureMetadata)


@dataclass(frozen=True)
class DeliveryFeatureObservation:
    turn_id: str
    start_sec: float
    end_sec: float
    clip_start_sec: float
    clip_end_sec: float
    audio_input_signature: str
    analyzer_version: str
    alignment: Mapping[str, Any]
    raw_features: Mapping[str, Any]
    evidence_state: EvidenceState
    capture_caveats: tuple[str, ...]
    suppression_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class DeliveryFeatureResult:
    """Session-level outcome for raw delivery extraction.

    An empty observation list is ambiguous: it can mean there were no eligible
    user turns, or that the recording/alignment was not safe to analyse.  The
    caller must be able to preserve that distinction for the API and UI.
    """

    state: EvidenceState
    reason: str | None
    observations: tuple[DeliveryFeatureObservation, ...]


def _round(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def _capture_caveats(metadata: CaptureMetadata) -> tuple[str, ...]:
    caveats: list[str] = []
    if metadata.automatic_gain_control is True:
        caveats.append("automatic_gain_control_enabled")
    if metadata.noise_suppression is True:
        caveats.append("noise_suppression_enabled")
    if metadata.echo_cancellation is True:
        caveats.append("echo_cancellation_enabled")
    if metadata.voice_isolation is True:
        caveats.append("voice_isolation_enabled")
    if metadata.microphone_label:
        caveats.append("microphone_metadata_present")
    if metadata.device_id:
        caveats.append("device_metadata_present")
    if metadata.extra:
        caveats.append("additional_capture_metadata_present")
    return tuple(caveats)


def _segment_map(segments: Sequence[SegmentClock]) -> dict[str, SegmentClock]:
    return {segment.segment_id: segment for segment in segments}

def _capture_for_turn(
    request: DeliveryFeatureRequest,
    turn: TurnWindow,
    segments: Mapping[str, SegmentClock],
) -> CaptureMetadata:
    segment = segments.get(turn.segment_id or "")
    return (
        segment.capture_metadata
        if segment and segment.capture_metadata
        else request.capture_metadata
    )


def _valid_segment_timeline(segments: Sequence[SegmentClock]) -> bool:
    if not segments:
        return True
    if len({segment.segment_id for segment in segments}) != len(segments):
        return False
    ordered = sorted(segments, key=lambda segment: segment.replay_offset_sec)
    expected_offset = 0.0
    for segment in ordered:
        if (
            not segment.audio_available
            or not np.isfinite(
                [segment.replay_offset_sec, segment.duration_sec]
            ).all()
            or segment.duration_sec <= 0
            or abs(segment.replay_offset_sec - expected_offset) > 1e-3
        ):
            return False
        expected_offset += segment.duration_sec
    return True


def _merged_interval(
    start_sec: float,
    end_sec: float,
    clock: AlignmentClock,
    segment_id: str | None,
    segments: Mapping[str, SegmentClock],
) -> tuple[float, float] | None:
    if clock == "merged":
        return start_sec, end_sec
    if not segment_id or segment_id not in segments:
        return None
    segment = segments[segment_id]
    if start_sec < 0 or end_sec > segment.duration_sec + 1e-6:
        return None
    return (
        start_sec + segment.replay_offset_sec,
        end_sec + segment.replay_offset_sec,
    )


def _suppressed(
    request: DeliveryFeatureRequest,
    turn: TurnWindow,
    reason: str,
    caveats: tuple[str, ...],
) -> DeliveryFeatureObservation:
    merged = _merged_interval(
        turn.start_sec,
        turn.end_sec,
        turn.clock,
        turn.segment_id,
        _segment_map(request.segments),
    )
    start_sec, end_sec = merged or (0.0, 0.0)
    return DeliveryFeatureObservation(
        turn_id=turn.turn_id,
        start_sec=_round(max(0.0, start_sec)),
        end_sec=_round(max(start_sec, end_sec)),
        clip_start_sec=_round(max(0.0, start_sec - _CLIP_CONTEXT_SEC)),
        clip_end_sec=_round(max(end_sec, start_sec)),
        audio_input_signature=request.audio_input_signature,
        analyzer_version=request.analyzer_version,
        alignment={
            "timing_origins": sorted({word.timing_origin for word in turn.words}),
            "coverage": _round(turn.alignment_coverage),
            "verified": False,
        },
        raw_features={},
        evidence_state="suppressed",
        capture_caveats=caveats,
        suppression_reason=reason,
    )


def _validate_and_merge_turn(
    turn: TurnWindow,
    segments: Mapping[str, SegmentClock],
) -> tuple[tuple[float, float], list[tuple[AlignedWord, float, float]]] | str:
    if not (0.0 <= turn.alignment_coverage <= 1.0):
        return "invalid_alignment_coverage"
    if turn.alignment_coverage < _MIN_ALIGNMENT_COVERAGE:
        return "incomplete_alignment"
    merged_window = _merged_interval(
        turn.start_sec,
        turn.end_sec,
        turn.clock,
        turn.segment_id,
        segments,
    )
    if merged_window is None:
        return "unmapped_segment_clock"
    window_start, window_end = merged_window
    if not np.isfinite([window_start, window_end]).all() or window_end <= window_start:
        return "invalid_turn_window"
    if not turn.words:
        return "incomplete_alignment"

    merged_words: list[tuple[AlignedWord, float, float]] = []
    previous_end = -1.0
    for word in turn.words:
        if word.turn_id != turn.turn_id:
            return "cross_turn_alignment"
        if word.timing_origin not in _VERIFIED_ORIGINS:
            return "unverified_timing_origin"
        merged = _merged_interval(
            word.start_sec,
            word.end_sec,
            word.clock,
            word.segment_id,
            segments,
        )
        if merged is None:
            return "unmapped_segment_clock"
        start_sec, end_sec = merged
        if (
            not np.isfinite([start_sec, end_sec]).all()
            or start_sec < window_start - 1e-6
            or end_sec > window_end + 1e-6
            or end_sec <= start_sec
            or start_sec < previous_end - 1e-6
        ):
            return "invalid_word_timestamps"
        merged_words.append((word, start_sec, end_sec))
        previous_end = end_sec
    return (window_start, window_end), merged_words


def _pause_intervals(
    words: Sequence[tuple[AlignedWord, float, float]],
) -> list[dict[str, Any]]:
    pauses: list[dict[str, Any]] = []
    for previous, following in zip(words, words[1:]):
        _, _, previous_end = previous
        _, following_start, _ = following
        duration = following_start - previous_end
        if duration <= 0:
            continue
        pauses.append(
            {
                "start_sec": _round(previous_end),
                "end_sec": _round(following_start),
                "duration_sec": _round(duration),
                "bounded_by": [previous[0].word, following[0].word],
            }
        )
    return pauses


def _extract_acoustics(
    sound: Any,
    word_spans: Sequence[tuple[AlignedWord, float, float]],
) -> tuple[dict[str, Any], bool]:
    """Aggregate waveform features only inside verified spoken-word spans.

    The enclosing turn can contain intentional pauses.  Including those silent
    stretches in intensity or harmonicity would turn a pause into an apparent
    change in vocal delivery, so they remain separate pause evidence.
    """
    voiced_chunks: list[np.ndarray] = []
    voiced_times: list[np.ndarray] = []
    intensity_chunks: list[np.ndarray] = []
    harmonicity_chunks: list[np.ndarray] = []
    pitch_step = 0.0

    for _, start_sec, end_sec in word_spans:
        window = sound.extract_part(
            from_time=start_sec,
            to_time=end_sec,
            preserve_times=True,
        )
        pitch = window.to_pitch(pitch_floor=75.0, pitch_ceiling=400.0)
        pitch_step = pitch.dx
        frequencies = np.asarray(pitch.selected_array["frequency"], dtype=float)
        voiced_mask = np.isfinite(frequencies) & (frequencies > 0)
        if np.any(voiced_mask):
            voiced_chunks.append(frequencies[voiced_mask])
            voiced_times.append(np.asarray(pitch.xs(), dtype=float)[voiced_mask])

        intensity = np.asarray(window.to_intensity().values, dtype=float).ravel()
        intensity = intensity[np.isfinite(intensity)]
        if len(intensity):
            intensity_chunks.append(intensity)

        harmonicity = np.asarray(window.to_harmonicity().values, dtype=float).ravel()
        harmonicity = harmonicity[
            np.isfinite(harmonicity) & (harmonicity > -100.0)
        ]
        if len(harmonicity):
            harmonicity_chunks.append(harmonicity)

    voiced = np.concatenate(voiced_chunks) if voiced_chunks else np.array([])
    frame_times = np.concatenate(voiced_times) if voiced_times else np.array([])
    intensity_values = (
        np.concatenate(intensity_chunks) if intensity_chunks else np.array([])
    )
    harmonicity_values = (
        np.concatenate(harmonicity_chunks) if harmonicity_chunks else np.array([])
    )

    enough_voicing = len(voiced) >= 3
    if enough_voicing:
        relative_times = frame_times - frame_times[0]
        slope = (
            float(np.polyfit(relative_times, voiced, 1)[0])
            if len(np.unique(relative_times)) >= 2
            else 0.0
        )
        contour_change = float(voiced[-1] - voiced[0])
    else:
        slope = 0.0
        contour_change = 0.0

    raw = {
        "mean_f0_hz": _round(np.mean(voiced)) if len(voiced) else None,
        "f0_spread_hz": _round(np.std(voiced)) if len(voiced) else None,
        "f0_contour_slope_hz_per_sec": _round(slope) if enough_voicing else None,
        "f0_contour_change_hz": _round(contour_change) if enough_voicing else None,
        "intensity_mean_db": (
            _round(np.mean(intensity_values)) if len(intensity_values) else None
        ),
        "intensity_spread_db": (
            _round(np.std(intensity_values)) if len(intensity_values) else None
        ),
        "harmonicity_hnr_db": (
            _round(np.mean(harmonicity_values))
            if len(harmonicity_values)
            else None
        ),
        "voiced_duration_sec": _round(len(voiced) * pitch_step),
        "measurement_basis": "verified_word_spans",
    }
    return raw, enough_voicing


def extract_delivery_feature_result(
    request: DeliveryFeatureRequest,
) -> DeliveryFeatureResult:
    """Extract raw per-turn observations from complete merged user audio.

    Missing segment audio fails closed for the whole session and emits no
    observations.  Turn-specific provenance failures emit a suppressed record,
    preserving an explicit reason without inventing acoustic measurements.
    """

    if not request.complete_segment_audio:
        return DeliveryFeatureResult("suppressed", "complete_recording_required", ())
    if not _valid_segment_timeline(request.segments):
        return DeliveryFeatureResult("suppressed", "invalid_segment_timeline", ())
    if (
        not request.audio_input_signature
        or request.audio_input_signature != request.expected_audio_input_signature
    ):
        segments = _segment_map(request.segments)
        return DeliveryFeatureResult("suppressed", "audio_signature_mismatch", tuple(
            _suppressed(
                request,
                turn,
                "audio_signature_mismatch",
                _capture_caveats(_capture_for_turn(request, turn, segments)),
            )
            for turn in request.turns
        ))
    if not request.analyzer_version.strip():
        return DeliveryFeatureResult("suppressed", "missing_analyzer_version", ())
    audio_path = Path(request.audio_path)
    if not audio_path.is_file() or not audio_path.stat().st_size:
        return DeliveryFeatureResult("suppressed", "recording_missing", ())

    try:
        import parselmouth

        sound = parselmouth.Sound(str(audio_path))
    except Exception:
        return DeliveryFeatureResult("suppressed", "recording_unreadable", ())

    audio_duration = float(sound.duration)
    if request.segments:
        expected_duration = sum(segment.duration_sec for segment in request.segments)
        duration_tolerance = max(0.25, expected_duration * 0.01)
        if abs(audio_duration - expected_duration) > duration_tolerance:
            return DeliveryFeatureResult("suppressed", "audio_timeline_mismatch", ())
    segments = _segment_map(request.segments)
    observations: list[DeliveryFeatureObservation] = []

    for turn in request.turns:
        caveats = _capture_caveats(_capture_for_turn(request, turn, segments))
        validated = _validate_and_merge_turn(turn, segments)
        if isinstance(validated, str):
            if validated == "unmapped_segment_clock":
                continue
            observations.append(_suppressed(request, turn, validated, caveats))
            continue
        (start_sec, end_sec), words = validated
        if start_sec < 0 or end_sec > audio_duration + 1e-3:
            observations.append(
                _suppressed(request, turn, "turn_outside_audio", caveats)
            )
            continue

        raw_features, enough_voicing = _extract_acoustics(sound, words)
        raw_features["pause_intervals"] = _pause_intervals(words)
        state: EvidenceState = (
            "available" if enough_voicing else "insufficient_evidence"
        )
        origins = sorted({word.timing_origin for word, _, _ in words})
        observations.append(
            DeliveryFeatureObservation(
                turn_id=turn.turn_id,
                start_sec=_round(start_sec),
                end_sec=_round(end_sec),
                clip_start_sec=_round(max(0.0, start_sec - _CLIP_CONTEXT_SEC)),
                clip_end_sec=_round(
                    min(audio_duration, end_sec + _CLIP_CONTEXT_SEC)
                ),
                audio_input_signature=request.audio_input_signature,
                analyzer_version=request.analyzer_version,
                alignment={
                    "timing_origins": origins,
                    "coverage": _round(turn.alignment_coverage),
                    "verified": True,
                    "clock": "merged_audio",
                },
                raw_features=raw_features,
                evidence_state=state,
                capture_caveats=caveats,
            )
        )
    state: EvidenceState = (
        "available"
        if any(item.evidence_state == "available" for item in observations)
        else "insufficient_evidence"
    )
    reason = None if observations else "no_eligible_turns"
    return DeliveryFeatureResult(state, reason, tuple(observations))


def extract_delivery_features(
    request: DeliveryFeatureRequest,
) -> list[DeliveryFeatureObservation]:
    """Compatibility wrapper for callers that only need turn observations."""
    return list(extract_delivery_feature_result(request).observations)


def observations_as_dicts(
    observations: Iterable[DeliveryFeatureObservation],
) -> list[dict[str, Any]]:
    return [observation.to_dict() for observation in observations]
