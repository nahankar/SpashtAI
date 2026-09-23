import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import AsyncMock

from audio_processor import (
    AudioProcessor,
    GentleAligner,
    PauseSegment,
    ProsodyMetrics,
    WordAlignment,
)


def _write_silence(path: Path) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\0\0" * 160)


class GentleAlignmentCacheTest(unittest.TestCase):
    def test_exact_audio_and_transcript_reuse_cached_alignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "speech.wav"
            _write_silence(audio)

            aligner = GentleAligner()
            aligner.cache_dir = root / "cache"
            cache_path = aligner._cache_path(str(audio), "hello world")
            expected = [
                WordAlignment(word="hello", start=0.0, end=0.2, confidence=1.0),
                WordAlignment(word="world", start=0.3, end=0.5, confidence=1.0),
            ]

            aligner._write_cached_alignment(cache_path, expected)

            self.assertEqual(aligner._read_cached_alignment(cache_path), expected)

    def test_changed_transcript_or_audio_gets_a_different_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "speech.wav"
            _write_silence(audio)

            aligner = GentleAligner()
            aligner.cache_dir = root / "cache"
            first = aligner._cache_path(str(audio), "hello world")
            changed_text = aligner._cache_path(str(audio), "hello there")

            with audio.open("ab") as audio_file:
                audio_file.write(b"\0\0")
            changed_audio = aligner._cache_path(str(audio), "hello world")

            self.assertNotEqual(first, changed_text)
            self.assertNotEqual(first, changed_audio)


class SuppliedAlignmentValidationTest(unittest.TestCase):
    def test_accepts_complete_monotonic_contained_stt_words(self):
        transcript = "one two three four five six seven eight nine ten"
        tokens = transcript.split()
        alignments = [
            WordAlignment(
                token,
                index * 0.4,
                index * 0.4 + 0.25,
                1.0,
                timing_origin="actual",
            )
            for index, token in enumerate(tokens)
        ]

        accepted = AudioProcessor._validate_supplied_alignments(
            alignments,
            transcript,
            audio_duration=5.0,
        )

        self.assertEqual(accepted, alignments)

    def test_rejects_incomplete_or_out_of_audio_stt_words(self):
        transcript = "one two three four five six seven eight nine ten"
        incomplete = [
            WordAlignment("one", 0.0, 0.2, 1.0, timing_origin="actual")
        ]
        tokens = transcript.split()
        outside_audio = [
            WordAlignment(
                token,
                index * 0.4,
                index * 0.4 + 0.25,
                1.0,
                timing_origin="actual",
            )
            for index, token in enumerate(tokens)
        ]
        outside_audio[-1] = WordAlignment(
            "ten", 4.8, 5.8, 1.0, timing_origin="actual"
        )

        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                incomplete,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )
        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                outside_audio,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )

    def test_rejects_timestamps_for_different_words(self):
        transcript = "one two three four five six seven eight nine ten"
        alignments = [
            WordAlignment(
                "mismatch",
                index * 0.4,
                index * 0.4 + 0.25,
                1.0,
                timing_origin="actual",
            )
            for index in range(10)
        ]

        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                alignments,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )

    def test_rejects_synthetic_karaoke_words_as_delivery_evidence(self):
        transcript = "one two three four five six seven eight nine ten"
        alignments = [
            WordAlignment(
                token,
                index * 0.4,
                index * 0.4 + 0.25,
                1.0,
                utterance_id="turn-1",
                timing_origin="synthetic",
            )
            for index, token in enumerate(transcript.split())
        ]

        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                alignments,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )


class DeliveryRateSemanticsTest(unittest.TestCase):
    def test_delivery_rate_excludes_short_cross_turn_gap(self):
        alignments = [
            WordAlignment("one", 0.0, 0.5, 1.0, utterance_id="turn-1", timing_origin="actual"),
            WordAlignment("two", 1.0, 1.5, 1.0, utterance_id="turn-1", timing_origin="actual"),
            WordAlignment("three", 2.7, 3.2, 1.0, utterance_id="turn-2", timing_origin="actual"),
        ]
        aligner = GentleAligner()

        speech_rate, articulation_rate = aligner.calculate_speech_rates(
            alignments,
            total_duration=30.0,
        )
        pauses = aligner.extract_pauses(alignments)

        self.assertAlmostEqual(speech_rate, 90.0)
        self.assertAlmostEqual(articulation_rate, 120.0)
        self.assertEqual(len(pauses), 1)
        self.assertAlmostEqual(pauses[0].duration, 0.5)
        self.assertEqual(pauses[0].context_before, "one")
        self.assertEqual(pauses[0].context_after, "two")
        self.assertEqual(pauses[0].utterance_id, "turn-1")


class DeliveryEvidenceContractTest(unittest.TestCase):
    def test_delivery_evidence_keeps_raw_measurements_separate_from_coaching_scores(self):
        processor = AudioProcessor("delivery-evidence-contract")
        alignments = [
            WordAlignment(
                word,
                index * 0.4,
                index * 0.4 + 0.2,
                1.0,
                utterance_id="turn-1",
                timing_origin="actual",
            )
            for index, word in enumerate(
                "one two three four five six seven eight nine ten".split()
            )
        ]
        pauses = [
            PauseSegment(1.8, 2.2, 0.4, "five", "six", "turn-1"),
        ]
        prosody = ProsodyMetrics(
            mean_pitch=145.0,
            pitch_range=80.0,
            pitch_variation=14.0,
            mean_intensity=62.0,
            intensity_stability=4.0,
            harmonicity_mean=8.0,
            speech_rate_precise=120.0,
            articulation_rate=150.0,
        )

        delivery = processor._calculate_delivery_metrics(
            alignments,
            pauses,
            prosody,
            "one two three four five six seven eight nine ten",
            5.0,
        )

        self.assertEqual(delivery.voice_quality_score, 0.0)
        self.assertNotIn("pause_appropriateness", delivery.confidence_indicators)
        self.assertEqual(delivery.delivery_evidence.schema_version, 1)
        self.assertEqual(delivery.delivery_evidence.analyzer_version, "praat-raw-v1")
        self.assertIsNone(delivery.delivery_evidence.audio_input_signature)
        self.assertEqual(delivery.delivery_evidence.status, "experimental")
        self.assertEqual(delivery.delivery_evidence.calibration_status, "uncalibrated")
        self.assertEqual(
            delivery.delivery_evidence.timing["source"],
            "validated_word_timestamps",
        )
        self.assertEqual(
            delivery.delivery_evidence.acoustic["raw_measurements"]["f0_std_hz"],
            14.0,
        )

    def test_no_audio_evidence_fails_closed(self):
        evidence = AudioProcessor("no-audio-evidence")._build_delivery_evidence(
            transcript="one two",
            alignments=[],
            pauses=[],
            prosody=None,
            timing_origin="unavailable",
            evidence_quality=0,
        )

        self.assertEqual(evidence.status, "insufficient_evidence")
        self.assertEqual(evidence.acoustic["source"], "unavailable")
        self.assertEqual(evidence.timing["transcript_coverage"], 0.0)


class SyntheticTimingFailClosedTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthetic_words_cannot_promote_delivery_without_forced_alignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio = Path(temp_dir) / "speech.wav"
            _write_silence(audio)
            transcript = "one two three four five six seven eight nine ten"
            synthetic = [
                WordAlignment(
                    token,
                    index * 0.001,
                    index * 0.001 + 0.001,
                    1.0,
                    utterance_id="turn-1",
                    timing_origin="synthetic",
                )
                for index, token in enumerate(transcript.split())
            ]
            processor = AudioProcessor("synthetic-fail-closed")
            processor.gentle_aligner.is_available = AsyncMock(return_value=False)

            delivery = await processor.analyze_delivery(
                transcript,
                str(audio),
                supplied_alignments=synthetic,
            )

            self.assertIsNotNone(delivery)
            self.assertEqual(delivery.speech_rate, 0.0)
            self.assertEqual(delivery.articulation_rate, 0.0)
            self.assertEqual(delivery.pause_count, 0)
            self.assertEqual(delivery.pause_profile, [])
            self.assertEqual(delivery.timing_origin, "unavailable")
            self.assertEqual(delivery.evidence_quality, 0)
            self.assertEqual(delivery.aligned_word_count, 0)


if __name__ == "__main__":
    unittest.main()
