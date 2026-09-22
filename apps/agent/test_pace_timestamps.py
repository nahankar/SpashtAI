from types import SimpleNamespace
import unittest

from pace_timestamps import validate_timestamp_evidence


class PaceTimestampValidationTest(unittest.TestCase):
    def test_accepts_complete_monotonic_contained_words(self):
        words = [
            SimpleNamespace(start_time=1.0, end_time=1.4),
            SimpleNamespace(start_time=1.5, end_time=2.0),
        ]
        evidence = validate_timestamp_evidence("hello world", 1.0, 2.0, words)

        self.assertTrue(evidence.word_timestamps_valid)
        self.assertEqual(evidence.timestamped_word_count, 2)
        self.assertEqual(evidence.coverage, 1.0)

    def test_rejects_out_of_order_and_out_of_segment_words(self):
        words = [
            SimpleNamespace(start_time=1.6, end_time=1.8),
            SimpleNamespace(start_time=1.2, end_time=1.4),
            SimpleNamespace(start_time=2.1, end_time=2.2),
        ]
        evidence = validate_timestamp_evidence("one two three", 1.0, 2.0, words)

        self.assertFalse(evidence.word_timestamps_valid)
        self.assertEqual(evidence.out_of_order_timestamp_count, 1)
        self.assertEqual(evidence.invalid_timestamp_count, 1)

    def test_rejects_non_finite_and_incomplete_coverage(self):
        words = [
            SimpleNamespace(start_time=0.0, end_time=0.2),
            SimpleNamespace(start_time=float("nan"), end_time=0.4),
        ]
        evidence = validate_timestamp_evidence("one two three", 0.0, 1.0, words)

        self.assertFalse(evidence.word_timestamps_valid)
        self.assertLess(evidence.coverage, 0.95)
        self.assertEqual(evidence.invalid_timestamp_count, 1)


if __name__ == "__main__":
    unittest.main()
