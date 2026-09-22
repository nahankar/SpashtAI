import unittest

from live_pacing import LivePacingTracker
from metrics_collector import MetricsCollector
from turn_metrics import compute_turn_metrics

_PREVIEW = "one two three four five six seven eight nine ten"
_FINAL = (
    "one two three four five six seven eight nine ten "
    "eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen"
)


def _wired_collector():
    collector = MetricsCollector("pace-lifecycle")
    tracker = LivePacingTracker()
    collector.set_utterance_peeker(tracker.peek_last_utterance)
    collector.set_session_totals_peeker(tracker.get_session_totals)
    collector.set_pace_evidence_peeker(tracker.get_pace_evidence)
    collector.set_pace_turn_acceptor(tracker.accept_logical_turn)
    return collector, tracker


class LivePacingEvidenceTest(unittest.TestCase):
    def test_timestamped_samples_are_authoritative(self):
        tracker = LivePacingTracker()
        tracker.ingest_measured_final(
            "one two three four five six seven eight nine ten",
            10,
            5.0,
            pace_source="word_timestamps",
            timestamped_word_count=10,
            transcript_word_count=10,
        )
        tracker.accept_logical_turn(10, 5.0, "word_timestamps")
        tracker.ingest_measured_final(
            "eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
            10,
            5.0,
            pace_source="word_timestamps",
            timestamped_word_count=10,
            transcript_word_count=10,
        )
        tracker.accept_logical_turn(10, 5.0, "word_timestamps")

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["status"], "available")
        self.assertEqual(evidence["source"], "word_timestamps")
        self.assertEqual(evidence["confidence"], "high")
        self.assertEqual(tracker.get_live_metrics().wpm, 120.0)

    def test_estimated_duration_cannot_score_overall_pace(self):
        tracker = LivePacingTracker()
        tracker.on_user_transcript("one two three four five six seven eight nine ten", True)
        first = tracker.peek_last_utterance()
        tracker.accept_logical_turn(first.words, first.seconds, first.pace_source)
        tracker.on_user_transcript(
            "eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
            True,
        )
        second = tracker.peek_last_utterance()
        tracker.accept_logical_turn(second.words, second.seconds, second.pace_source)

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["status"], "insufficient_evidence")
        self.assertEqual(evidence["observedEstimatedSamples"], 2)
        self.assertEqual(evidence["excludedUnreliableTurnCount"], 2)
        self.assertEqual(tracker.get_live_metrics().wpm, 0.0)

    def test_first_timestamped_sample_discards_earlier_estimate(self):
        tracker = LivePacingTracker()
        tracker.on_user_transcript("estimated words should be discarded", True)
        tracker.ingest_measured_final(
            "measured one two three four five six seven eight nine",
            10,
            6.0,
            pace_source="validated_turn_audio",
        )
        tracker.accept_logical_turn(10, 6.0, "validated_turn_audio")

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["totalWords"], 10)
        self.assertEqual(evidence["estimatedSamples"], 0)

    def test_micro_turns_are_observed_but_excluded_from_headline(self):
        tracker = LivePacingTracker()
        tracker.ingest_measured_final(
            "tiny fragment",
            2,
            0.8,
            pace_source="validated_turn_audio",
        )
        tracker.accept_logical_turn(2, 0.8, "validated_turn_audio")

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["observedWords"], 2)
        self.assertEqual(evidence["totalWords"], 0)
        self.assertEqual(evidence["excludedMicroTurnCount"], 1)

    def test_short_fast_burst_does_not_satisfy_headline_sample_count(self):
        tracker = LivePacingTracker()
        tracker.ingest_measured_final(
            "one two three four five six seven eight",
            8,
            1.57,
            pace_source="word_timestamps",
            timestamped_word_count=8,
            transcript_word_count=8,
        )
        tracker.accept_logical_turn(8, 1.57, "word_timestamps")
        tracker.ingest_measured_final(
            "nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen "
            "nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five "
            "twenty-six twenty-seven twenty-eight",
            20,
            10.0,
            pace_source="word_timestamps",
            timestamped_word_count=20,
            transcript_word_count=20,
        )
        tracker.accept_logical_turn(20, 10.0, "word_timestamps")

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["status"], "insufficient_evidence")
        self.assertEqual(evidence["samples"], 1)
        self.assertEqual(evidence["observedSamples"], 2)
        self.assertEqual(evidence["excludedShortDurationCount"], 1)

    def test_estimated_turn_does_not_emit_pace_advice(self):
        metrics = compute_turn_metrics("this estimated turn has several spoken words")

        self.assertEqual(metrics.pace_source, "estimated")
        self.assertEqual(metrics.qualitative_pace, "not-enough-data")
        self.assertNotIn("pacing", metrics.coaching_tip.lower())
        self.assertNotIn("energy", metrics.coaching_tip.lower())

    def test_pending_then_commit_accepts_one_sample(self):
        collector, tracker = _wired_collector()
        tracker.ingest_measured_final(_PREVIEW, 10, 5.0, pace_source="word_timestamps")
        collector.ingest_conversation_fragment("user", _PREVIEW, 1.0)
        self.assertTrue(collector.publish_pending_user_utterance_metrics())
        self.assertEqual(tracker.get_pace_evidence()["samples"], 0)

        collector.ingest_conversation_fragment("assistant", "Thanks, tell me more.", 2.0)
        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["samples"], 1)
        self.assertEqual(evidence["totalWords"], 10)
        self.assertEqual(evidence["speakingSeconds"], 5.0)
        self.assertEqual(evidence["status"], "insufficient_evidence")

    def test_pending_partial_is_replaced_by_expanded_final(self):
        collector, tracker = _wired_collector()
        tracker.ingest_measured_final(_PREVIEW, 10, 5.0, pace_source="word_timestamps")
        collector.ingest_conversation_fragment("user", _PREVIEW, 1.0)
        self.assertTrue(collector.publish_pending_user_utterance_metrics())
        self.assertEqual(tracker.get_pace_evidence()["samples"], 0)

        tracker.ingest_measured_final(_FINAL, 18, 4.0, pace_source="word_timestamps")
        collector.ingest_conversation_fragment("user", _FINAL, 1.5)
        collector.ingest_conversation_fragment("assistant", "Got it.", 2.0)

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["samples"], 1)
        self.assertEqual(evidence["totalWords"], 18)
        self.assertEqual(evidence["speakingSeconds"], 9.0)
        self.assertEqual(evidence["status"], "insufficient_evidence")

    def test_one_logical_turn_shown_twice_is_still_insufficient(self):
        collector, tracker = _wired_collector()
        tracker.ingest_measured_final(_PREVIEW, 10, 5.0, pace_source="word_timestamps")
        collector.ingest_conversation_fragment("user", _PREVIEW, 1.0)
        collector.publish_pending_user_utterance_metrics()
        collector.publish_pending_user_utterance_metrics()
        collector.ingest_conversation_fragment("assistant", "Continue.", 2.0)

        evidence = tracker.get_pace_evidence()
        self.assertEqual(evidence["samples"], 1)
        self.assertEqual(evidence["status"], "insufficient_evidence")
        self.assertEqual(tracker.get_live_metrics().wpm, 0.0)


if __name__ == "__main__":
    unittest.main()
