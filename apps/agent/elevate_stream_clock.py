"""Sample-clock envelope of audio actually pushed into an Elevate STT stream.

The envelope is a 20 ms RMS sequence of the frames forwarded to the speech
provider. It is not a recording offset. The server may correlate it with the
retained browser recording; callback time and the SDK's wall-clock
``start_time_offset`` are not used as that offset.

A stream whose provider offset changes after it starts is not exported. That
reconnect has no sample anchor inside this envelope.
"""

from __future__ import annotations

from array import array
import base64
import math
import zlib
from typing import Any

VERSION = "elevate-stream-clock-v1"
HOP_SEC = 0.02
RMS_SCALE = 128
MIN_HOPS = 50  # one second; shorter spans are not a correlation template
MAX_HOPS = 45 * 60 * 50
MAX_ENVELOPE_CHARS = 80_000


class _EpochClock:
    def __init__(self, epoch: int):
        self.epoch = epoch
        self.sample_rate: int | None = None
        self._pending = array("h")
        self._hops = bytearray()
        self.mappable = True
        self.reason = "recording_correlation_pending"

    def invalidate(self, reason: str) -> None:
        self.mappable = False
        self.reason = reason
        self._pending = array("h")
        self._hops = bytearray()

    def push(self, frame: object) -> None:
        if not self.mappable:
            return
        rate = getattr(frame, "sample_rate", None)
        channels = getattr(frame, "num_channels", None)
        count = getattr(frame, "samples_per_channel", None)
        data = getattr(frame, "data", None)
        if (
            isinstance(rate, bool) or not isinstance(rate, int) or not 8_000 <= rate <= 96_000
            or isinstance(channels, bool) or not isinstance(channels, int) or channels < 1
            or isinstance(count, bool) or not isinstance(count, int) or count < 1
            or data is None
        ):
            self.invalidate("invalid_audio_frame")
            return
        if self.sample_rate is None:
            self.sample_rate = rate
        elif rate != self.sample_rate:
            self.invalidate("sample_rate_changed")
            return
        raw = data.tobytes() if hasattr(data, "tobytes") else bytes(data)
        needed = count * channels * 2
        if len(raw) < needed:
            self.invalidate("invalid_audio_frame")
            return
        samples = array("h")
        samples.frombytes(raw[:needed])
        if channels == 1:
            mono = samples
        else:
            mono = array("h")
            for index in range(0, count * channels, channels):
                mono.append(int(sum(samples[index:index + channels]) / channels))
        self._pending.extend(mono)
        hop = max(1, int(round(self.sample_rate * HOP_SEC)))
        while len(self._pending) >= hop:
            if len(self._hops) >= MAX_HOPS:
                self.invalidate("clock_limit_exceeded")
                return
            window = self._pending[:hop]
            del self._pending[:hop]
            total = 0.0
            for sample in window:
                total += float(sample) * float(sample)
            rms = math.sqrt(total / hop)
            self._hops.append(min(255, int(rms / RMS_SCALE)))

    def export(self) -> dict[str, Any] | None:
        if not self.mappable or self.sample_rate is None or len(self._hops) < MIN_HOPS:
            return None
        encoded = base64.b64encode(zlib.compress(bytes(self._hops), 9)).decode("ascii")
        if len(encoded) > MAX_ENVELOPE_CHARS:
            return None
        return {
            "version": VERSION,
            "epoch": self.epoch,
            "sampleRate": self.sample_rate,
            "hopSec": HOP_SEC,
            "encoding": "zlib",
            "envelope": encoded,
            "hops": len(self._hops),
        }


class StreamClockTracker:
    """One tracker per Elevate conversation. Not thread-safe."""

    def __init__(self) -> None:
        self._clocks: dict[int, _EpochClock] = {}

    def open_epoch(self, epoch: int) -> None:
        if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0:
            raise ValueError("invalid_stream_epoch")
        self._clocks.setdefault(epoch, _EpochClock(epoch))

    def push(self, epoch: int, frame: object) -> None:
        clock = self._clocks.get(epoch)
        if clock is not None:
            clock.push(frame)

    def invalidate(self, epoch: int, reason: str) -> None:
        clock = self._clocks.get(epoch)
        if clock is not None:
            clock.invalidate(reason)

    def export(self) -> list[dict[str, Any]]:
        exported = []
        for epoch in sorted(self._clocks):
            payload = self._clocks[epoch].export()
            if payload is not None:
                exported.append(payload)
        return exported
