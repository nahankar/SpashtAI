import unittest

import numpy as np

from audio_processor import summarize_praat_frames


class PraatFrameSummaryTest(unittest.TestCase):
    def test_unvoiced_harmonicity_frames_are_excluded(self):
        summary = summarize_praat_frames(
            np.array([150.0, 0.0, 155.0]),
            np.array([60.0, 61.0, 59.0]),
            np.array([-200.0, 12.0, -200.0, 14.0, np.nan]),
        )

        self.assertAlmostEqual(summary["harmonicity_mean"], 13.0)

    def test_all_unvoiced_harmonicity_is_unavailable(self):
        summary = summarize_praat_frames(
            np.array([150.0]),
            np.array([60.0]),
            np.array([-200.0, -200.0]),
        )

        self.assertIsNone(summary["harmonicity_mean"])

    def test_silence_does_not_dominate_intensity_stability(self):
        speech = np.array([60.0, 61.0, 59.0, 60.0])
        with_silence = np.concatenate([speech, np.full(20, 5.0)])

        self.assertAlmostEqual(
            summarize_praat_frames(np.array([150.0]), with_silence, np.array([10.0]))[
                "intensity_stability"
            ],
            summarize_praat_frames(np.array([150.0]), speech, np.array([10.0]))[
                "intensity_stability"
            ],
        )

    def test_octave_jumps_do_not_inflate_pitch_spread(self):
        steady = np.array([148.0, 150.0, 152.0, 149.0, 151.0])
        with_octave_errors = np.concatenate([steady, np.array([300.0, 75.0])])

        summary = summarize_praat_frames(
            with_octave_errors, np.array([60.0]), np.array([10.0])
        )

        self.assertLess(summary["pitch_variation"], 3.0)
        self.assertAlmostEqual(summary["mean_pitch"], 150.0)


if __name__ == "__main__":
    unittest.main()
