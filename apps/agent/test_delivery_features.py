import tempfile
import hashlib
import subprocess
import unittest
import wave
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import numpy as np

from delivery_features import (
    AlignedWord,
    CaptureMetadata,
    DeliveryFeatureRequest,
    SegmentClock,
    TurnWindow,
    extract_delivery_feature_result,
    extract_delivery_features,
)


def _write_test_audio(path: Path, duration_sec: float = 6.0) -> None:
    sample_rate = 16000
    times = np.arange(int(sample_rate * duration_sec), dtype=float) / sample_rate
    # Two stable voiced regions separated by silence. The extractor reports raw
    # waveform observations; word timestamps, not silence detection, bound pauses.
    signal = np.zeros_like(times)
    first = (times >= 0.25) & (times < 2.0)
    second = (times >= 2.5) & (times < 5.75)
    signal[first] = 0.25 * np.sin(2 * np.pi * 140 * times[first])
    signal[second] = 0.20 * np.sin(2 * np.pi * 180 * times[second])
    pcm = np.asarray(signal * 32767, dtype="<i2")
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(pcm.tobytes())


def _words(
    *,
    turn_id: str = "turn-1",
    origin: str = "actual",
    segment_id: str | None = None,
    clock: str = "merged",
) -> tuple[AlignedWord, ...]:
    return (
        AlignedWord(
            "First",
            0.5,
            0.9,
            turn_id,
            origin,  # type: ignore[arg-type]
            segment_id,
            clock,  # type: ignore[arg-type]
        ),
        AlignedWord(
            "point",
            1.0,
            1.4,
            turn_id,
            origin,  # type: ignore[arg-type]
            segment_id,
            clock,  # type: ignore[arg-type]
        ),
        AlignedWord(
            "second",
            2.2,
            2.6,
            turn_id,
            origin,  # type: ignore[arg-type]
            segment_id,
            clock,  # type: ignore[arg-type]
        ),
        AlignedWord(
            "point",
            2.7,
            3.1,
            turn_id,
            origin,  # type: ignore[arg-type]
            segment_id,
            clock,  # type: ignore[arg-type]
        ),
    )


class DeliveryFeatureExtractionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.audio_path = Path(self.temp_dir.name) / "merged-user.wav"
        _write_test_audio(self.audio_path)
        self.turn = TurnWindow(
            turn_id="turn-1",
            start_sec=0.25,
            end_sec=3.4,
            words=_words(),
            alignment_coverage=1.0,
        )
        self.request = DeliveryFeatureRequest(
            audio_path=str(self.audio_path),
            audio_input_signature="server-signature",
            expected_audio_input_signature="server-signature",
            analyzer_version="delivery-raw-v1",
            turns=(self.turn,),
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_valid_aligned_turn_emits_raw_units_and_bounded_pause(self) -> None:
        result = extract_delivery_features(self.request)

        self.assertEqual(len(result), 1)
        observation = result[0]
        self.assertEqual(observation.evidence_state, "available")
        self.assertEqual(observation.audio_input_signature, "server-signature")
        self.assertEqual(observation.alignment["clock"], "merged_audio")
        self.assertEqual(observation.raw_features["measurement_basis"], "verified_word_spans")
        self.assertGreater(observation.raw_features["mean_f0_hz"], 0)
        self.assertGreater(observation.raw_features["intensity_mean_db"], 0)
        self.assertGreater(observation.raw_features["voiced_duration_sec"], 0)
        self.assertEqual(
            observation.raw_features["pause_intervals"][1],
            {
                "start_sec": 1.4,
                "end_sec": 2.2,
                "duration_sec": 0.8,
                "bounded_by": ["point", "second"],
            },
        )
        serialized = observation.to_dict()
        self.assertFalse(any("score" in key for key in serialized["raw_features"]))
        self.assertNotIn("confidence", serialized["raw_features"])

    def test_synthetic_timing_is_suppressed(self) -> None:
        synthetic = replace(self.turn, words=_words(origin="synthetic"))
        result = extract_delivery_features(replace(self.request, turns=(synthetic,)))

        self.assertEqual(result[0].evidence_state, "suppressed")
        self.assertEqual(result[0].suppression_reason, "unverified_timing_origin")
        self.assertEqual(result[0].raw_features, {})

    def test_signature_mismatch_is_suppressed(self) -> None:
        result = extract_delivery_features(
            replace(self.request, expected_audio_input_signature="different")
        )

        self.assertEqual(result[0].evidence_state, "suppressed")
        self.assertEqual(result[0].suppression_reason, "audio_signature_mismatch")

    def test_pause_resume_segment_offsets_map_to_merged_clock(self) -> None:
        first_segment = SegmentClock(
            segment_id="segment-1",
            replay_offset_sec=0.0,
            duration_sec=3.0,
        )
        segment = SegmentClock(
            segment_id="segment-2",
            replay_offset_sec=3.0,
            duration_sec=3.0,
            capture_metadata=CaptureMetadata(
                automatic_gain_control=True,
                noise_suppression=False,
            ),
        )
        segment_words = _words(
            turn_id="turn-2",
            segment_id="segment-2",
            clock="segment",
        )
        segment_words = (
            segment_words[0],
            segment_words[1],
            replace(segment_words[2], start_sec=2.0, end_sec=2.3),
            replace(segment_words[3], start_sec=2.4, end_sec=2.8),
        )
        local_turn = TurnWindow(
            turn_id="turn-2",
            start_sec=0.25,
            end_sec=2.9,
            words=segment_words,
            alignment_coverage=1.0,
            segment_id="segment-2",
            clock="segment",
        )
        result = extract_delivery_features(
            replace(
                self.request,
                turns=(local_turn,),
                segments=(first_segment, segment),
            )
        )

        self.assertEqual(result[0].start_sec, 3.25)
        self.assertEqual(result[0].end_sec, 5.9)
        self.assertIn("automatic_gain_control_enabled", result[0].capture_caveats)
        self.assertEqual(
            result[0].raw_features["pause_intervals"][1]["start_sec"],
            4.4,
        )
        self.assertEqual(
            result[0].raw_features["pause_intervals"][1]["end_sec"],
            5.0,
        )

    def test_agc_metadata_is_preserved_as_capture_caveat(self) -> None:
        request = replace(
            self.request,
            capture_metadata=CaptureMetadata(automatic_gain_control=True),
        )

        self.assertIn(
            "automatic_gain_control_enabled",
            extract_delivery_features(request)[0].capture_caveats,
        )

    def test_missing_segment_audio_emits_no_partial_observation(self) -> None:
        available = SegmentClock(
            segment_id="segment-1",
            replay_offset_sec=0.0,
            duration_sec=3.0,
        )
        missing = SegmentClock(
            segment_id="segment-2",
            replay_offset_sec=3.0,
            duration_sec=3.0,
            audio_available=False,
        )

        self.assertEqual(
            extract_delivery_features(
                replace(self.request, segments=(available, missing))
            ),
            [],
        )
        outcome = extract_delivery_feature_result(
            replace(self.request, complete_segment_audio=False)
        )
        self.assertEqual(outcome.state, "suppressed")
        self.assertEqual(outcome.reason, "complete_recording_required")
        self.assertEqual(outcome.observations, ())
        self.assertEqual(
            extract_delivery_features(
                replace(self.request, complete_segment_audio=False)
            ),
            [],
        )

    def test_overlapping_or_incomplete_segment_clock_is_rejected(self) -> None:
        invalid = (
            SegmentClock("segment-1", 0.0, 3.0),
            SegmentClock("segment-2", 2.5, 3.5),
        )

        self.assertEqual(
            extract_delivery_features(
                replace(self.request, segments=invalid)
            ),
            [],
        )

    def test_out_of_window_and_non_monotonic_words_are_rejected(self) -> None:
        outside = replace(
            self.turn,
            words=(
                *self.turn.words[:-1],
                replace(self.turn.words[-1], end_sec=4.0),
            ),
        )
        non_monotonic = replace(
            self.turn,
            words=(
                self.turn.words[0],
                replace(self.turn.words[1], start_sec=0.7, end_sec=0.8),
                *self.turn.words[2:],
            ),
        )

        self.assertEqual(
            extract_delivery_features(
                replace(self.request, turns=(outside,))
            )[0].suppression_reason,
            "invalid_word_timestamps",
        )
        self.assertEqual(
            extract_delivery_features(
                replace(self.request, turns=(non_monotonic,))
            )[0].suppression_reason,
            "invalid_word_timestamps",
        )

    def test_same_audio_and_alignment_are_deterministic(self) -> None:
        first = [item.to_dict() for item in extract_delivery_features(self.request)]
        second = [item.to_dict() for item in extract_delivery_features(self.request)]

        self.assertEqual(first, second)

    def test_tiny_aligned_words_do_not_crash_other_acoustic_observations(self) -> None:
        words = (replace(self.turn.words[0], end_sec=0.51), *self.turn.words[1:])
        result = extract_delivery_feature_result(replace(self.request,
            turns=(replace(self.turn, words=words),)))
        self.assertEqual(result.state, "available")
        self.assertGreater(result.observations[0].raw_features["voiced_duration_sec"], 0)
        self.assertEqual(result.observations[0].raw_features["pause_intervals"][0]["start_sec"], 0.51)

    def test_only_tiny_word_windows_return_insufficient_evidence_without_invented_pitch(self) -> None:
        words = tuple(replace(word, end_sec=word.start_sec+0.01) for word in self.turn.words)
        result = extract_delivery_feature_result(replace(self.request,
            turns=(replace(self.turn, words=words),)))
        self.assertEqual(result.state, "insufficient_evidence")
        self.assertEqual(result.observations[0].evidence_state, "insufficient_evidence")
        self.assertIsNone(result.observations[0].raw_features["mean_f0_hz"])
        self.assertEqual(result.observations[0].raw_features["voiced_duration_sec"], 0)

    def test_browser_webm_is_decoded_without_changing_clock_or_original(self) -> None:
        webm = self.audio_path.with_suffix(".webm")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(self.audio_path),
            "-c:a", "libopus", str(webm)], check=True, timeout=20, capture_output=True)
        original_hash = hashlib.sha256(webm.read_bytes()).hexdigest()
        converted = []
        create_temp = tempfile.NamedTemporaryFile

        def track_temp(*args, **kwargs):
            result = create_temp(*args, **kwargs)
            converted.append(Path(result.name))
            return result

        with patch("analytics.prosody.tempfile.NamedTemporaryFile", side_effect=track_temp):
            result = extract_delivery_feature_result(replace(self.request,
                audio_path=str(webm), segments=(SegmentClock("segment", 0.0, 6.0),)))
        self.assertEqual(result.state, "available")
        observation = result.observations[0]
        self.assertEqual(observation.start_sec, self.turn.start_sec)
        self.assertEqual(observation.end_sec, self.turn.end_sec)
        self.assertEqual(observation.audio_input_signature, "server-signature")
        self.assertEqual(observation.raw_features["pause_intervals"][1]["duration_sec"], 0.8)
        self.assertGreater(observation.raw_features["voiced_duration_sec"], 0)
        self.assertTrue(converted)
        self.assertTrue(all(not path.exists() for path in converted))
        self.assertEqual(hashlib.sha256(webm.read_bytes()).hexdigest(), original_hash)

    def test_corrupt_browser_recording_fails_closed_and_removes_temporary_audio(self) -> None:
        webm = self.audio_path.with_suffix(".webm")
        webm.write_bytes(b"invalid browser audio")
        converted = []
        create_temp = tempfile.NamedTemporaryFile

        def track_temp(*args, **kwargs):
            result = create_temp(*args, **kwargs)
            converted.append(Path(result.name))
            return result

        with patch("analytics.prosody.tempfile.NamedTemporaryFile", side_effect=track_temp):
            result = extract_delivery_feature_result(replace(self.request, audio_path=str(webm)))
        self.assertEqual(result.state, "suppressed")
        self.assertEqual(result.reason, "recording_unreadable")
        self.assertEqual(result.observations, ())
        self.assertTrue(converted)
        self.assertTrue(all(not path.exists() for path in converted))

    def test_conversion_timeout_is_bounded_and_cleans_up(self) -> None:
        webm = self.audio_path.with_suffix(".webm")
        webm.write_bytes(b"browser audio")
        converted = []
        create_temp = tempfile.NamedTemporaryFile

        def track_temp(*args, **kwargs):
            result = create_temp(*args, **kwargs)
            converted.append(Path(result.name))
            return result

        with patch("analytics.prosody.tempfile.NamedTemporaryFile", side_effect=track_temp), \
             patch("analytics.prosody.subprocess.run", side_effect=subprocess.TimeoutExpired("ffmpeg", 20)) as convert:
            result = extract_delivery_feature_result(replace(self.request, audio_path=str(webm)))
        self.assertEqual(result.reason, "recording_unreadable")
        self.assertEqual(convert.call_args.kwargs["timeout"], 20)
        self.assertTrue(converted)
        self.assertTrue(all(not path.exists() for path in converted))


if __name__ == "__main__":
    unittest.main()
