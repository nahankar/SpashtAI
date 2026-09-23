import unittest
from types import SimpleNamespace

from audio_processor import DeliveryEvidence, DeliveryMetrics
from scoring_engine import ScoringEngine


def delivery_with_evidence(status: str, timing_source: str, quality: int) -> DeliveryMetrics:
    return DeliveryMetrics(
        speech_rate=240.0,
        articulation_rate=280.0,
        pause_count=9,
        mean_pause_duration=0.1,
        max_pause_duration=2.0,
        filler_word_count=1,
        filler_word_rate=2.0,
        pitch_variation=99.0,
        energy_stability=9.0,
        voice_quality_score=9.0,
        confidence_indicators={},
        pause_profile=[],
        timing_origin=timing_source,
        evidence_quality=quality,
        aligned_word_count=20,
        delivery_evidence=DeliveryEvidence(
            schema_version=1,
            analyzer_version="praat-raw-v1",
            audio_input_signature=None,
            status=status,
            calibration_status="uncalibrated",
            timing={"source": timing_source, "evidence_quality": quality},
            acoustic={},
            capture={},
        ),
    )


class CalibratedDeliveryScoringTest(unittest.TestCase):
    def test_untrusted_timing_cannot_change_fluency_or_confidence_scores(self):
        scorer = ScoringEngine()
        untrusted = delivery_with_evidence("insufficient_evidence", "unavailable", 0)
        trusted = delivery_with_evidence("experimental", "validated_word_timestamps", 3)

        # The wildly fast raw rate must not lower the score until timing is
        # verified.  Filler evidence remains scoreable and is renormalized.
        self.assertEqual(scorer._calculate_fluency_score(untrusted, None), 10.0)
        self.assertLess(scorer._calculate_fluency_score(trusted, None), 10.0)

        # Acoustic indices do not create a social claim about confidence.
        content = SimpleNamespace(confidence_language=3.0)
        self.assertEqual(scorer._calculate_confidence_score(untrusted, content), 3.0)

    def test_trusted_alignment_is_the_only_delivery_rate_allowed_into_benchmarks(self):
        scorer = ScoringEngine()
        untrusted = delivery_with_evidence("insufficient_evidence", "unavailable", 0)
        trusted = delivery_with_evidence("experimental", "forced_alignment", 2)

        self.assertNotIn("speech_rate", scorer._compare_to_benchmarks(untrusted, None, None))
        self.assertIn("speech_rate", scorer._compare_to_benchmarks(trusted, None, None))


if __name__ == "__main__":
    unittest.main()
