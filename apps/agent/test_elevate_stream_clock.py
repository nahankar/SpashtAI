"""The STT envelope is a sample clock, not a recording offset."""

from array import array
import base64
import unittest
import zlib

from elevate_stream_clock import HOP_SEC, RMS_SCALE, StreamClockTracker
from elevate_turn_upload import attach_stream_clocks


def frame(value=1280, count=320, rate=16000, channels=1):
    class Frame:
        pass

    item = Frame()
    item.sample_rate = rate
    item.num_channels = channels
    item.samples_per_channel = count
    if channels == 1:
        samples = [value] * count
    else:
        samples = []
        for _ in range(count):
            samples.extend([value, value])
    item.data = array("h", samples)
    return item


class StreamClockTests(unittest.TestCase):
    def test_constant_frame_rms_uses_the_shared_scale(self):
        tracker = StreamClockTracker()
        tracker.open_epoch(1)
        for _ in range(50):
            tracker.push(1, frame(1280))
        exported = tracker.export()
        self.assertEqual(len(exported), 1)
        clock = exported[0]
        self.assertEqual(clock["version"], "elevate-stream-clock-v1")
        self.assertEqual(clock["hopSec"], HOP_SEC)
        self.assertEqual(clock["hops"], 50)
        raw = zlib.decompress(base64.b64decode(clock["envelope"]))
        self.assertEqual(raw, bytes([min(255, int(1280 / RMS_SCALE))]) * 50)

    def test_short_or_reconnected_stream_is_not_exported(self):
        tracker = StreamClockTracker()
        tracker.open_epoch(1)
        tracker.push(1, frame())
        self.assertEqual(tracker.export(), [])
        for _ in range(50):
            tracker.push(1, frame())
        tracker.invalidate(1, "stream_epoch_changed")
        self.assertEqual(tracker.export(), [])

    def test_second_epoch_is_independent(self):
        tracker = StreamClockTracker()
        tracker.open_epoch(1)
        tracker.open_epoch(2)
        for _ in range(50):
            tracker.push(2, frame(640))
        exported = tracker.export()
        self.assertEqual([item["epoch"] for item in exported], [2])

    def test_oversized_clock_snapshot_is_left_off_the_turn_upload(self):
        batches = [{"turns": [{"turnIndex": 0, "role": "user", "text": "hello"}]}]
        clocks = [{"envelope": "x" * 200_000}]
        with self.assertLogs("spashtai-agent.elevate_turn_upload", level="WARNING"):
            attached = attach_stream_clocks(batches, clocks)
        self.assertNotIn("streamClocks", attached[0])
        attached = attach_stream_clocks(batches, [{"epoch": 1, "envelope": "abc"}])
        self.assertEqual(attached[0]["streamClocks"], [{"epoch": 1, "envelope": "abc"}])
        self.assertEqual(attached[0]["turns"][0]["text"], "hello")


if __name__ == "__main__":
    unittest.main()
