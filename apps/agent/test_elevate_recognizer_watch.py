import logging
import unittest

from elevate_recognizer_watch import ElevateRecognizerMonitor
from interview_audio import RecognizerWatch


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ElevateRecognizerMonitorTests(unittest.TestCase):
    def make(self):
        clock = FakeClock()
        monitor = ElevateRecognizerMonitor(RecognizerWatch(stall=6.0, min_voiced=1.5, clock=clock), clock=clock,
                                           log=logging.getLogger("test.elevate_stt"))
        monitor.new_stream()
        return clock, monitor

    def test_reports_once_when_detected_speech_gets_no_result(self):
        clock, monitor = self.make()
        monitor.speech_started(clock.now)
        for _ in range(300):
            monitor.frame()
        clock.now += 26.0
        monitor.speech_ended(clock.now)
        with self.assertLogs("test.elevate_stt", "WARNING") as logs:
            self.assertTrue(monitor.check())
            clock.now += 5
            self.assertTrue(monitor.check())
        self.assertEqual(len(logs.records), 1)
        record = logs.records[0]
        self.assertEqual(record.frames_forwarded, 300)
        self.assertEqual(record.finals, 0)
        self.assertIsNone(record.last_result_age)

    def test_results_keep_a_long_turn_healthy_and_a_late_result_reports_recovery(self):
        clock, monitor = self.make()
        monitor.speech_started(clock.now)
        for _ in range(5):
            clock.now += 2.0
            monitor.result(False)
            self.assertFalse(monitor.check())
        clock.now += 1.0
        monitor.speech_ended(clock.now)
        monitor.result(True)
        self.assertFalse(monitor.check())

        monitor.speech_started(clock.now)
        clock.now += 8.0
        with self.assertLogs("test.elevate_stt", "WARNING") as logs:
            self.assertTrue(monitor.check())
            monitor.result(True)
        self.assertIn("resumed", logs.records[-1].getMessage())
        self.assertFalse(monitor.check())

    def test_silence_and_short_sounds_are_owed_nothing(self):
        clock, monitor = self.make()
        clock.now += 60
        self.assertFalse(monitor.check())
        monitor.speech_started(clock.now)
        clock.now += 0.4
        monitor.speech_ended(clock.now)
        clock.now += 30
        self.assertFalse(monitor.check())


if __name__ == "__main__":
    unittest.main()
