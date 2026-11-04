"""Observe-only recognizer supervision for Elevate streaming STT.

Interview already restarts an Amazon Transcribe stream that stops returning results (see interview_audio).
Elevate has no such recovery; this monitor only makes that boundary observable: it logs when detected learner
speech is owed a result and none arrives, separating "audio reached the recognizer" (frames forwarded) from
"the recognizer returned something" (interim/final). It never changes audio, transcripts or turn taking.
"""
import asyncio
import logging
import time
from collections.abc import Callable

from interview_audio import RecognizerWatch

logger = logging.getLogger("spashtai-agent.elevate_stt")

CHECK_INTERVAL_SECONDS = 1.0


class ElevateRecognizerMonitor:
    def __init__(self, watch: RecognizerWatch | None = None, clock: Callable[[], float] = time.time,
                 log: logging.Logger = logger):
        self.clock = clock
        self.watch = watch or RecognizerWatch(clock=clock)
        self.log = log
        self.stream = 0
        self.frames = 0
        self.last_frame_at: float | None = None
        self.interims = 0
        self.finals = 0
        self.stalled_since: float | None = None

    def new_stream(self) -> None:
        self.stream += 1
        self.frames = 0
        self.watch.new_stream()
        self.log.info("Elevate recognizer stream opened", extra={"stt_stream": self.stream})

    def frame(self) -> None:
        self.frames += 1
        self.last_frame_at = self.clock()

    def speech_started(self, at: float | None = None) -> None:
        self.watch.speech_started(at)

    def speech_ended(self, at: float | None = None) -> None:
        self.watch.speech_ended(at)

    def result(self, final: bool) -> None:
        if final:
            self.finals += 1
        else:
            self.interims += 1
        self.watch.result(final)
        if self.stalled_since is not None:
            self.log.warning("Elevate recognizer resumed after a stall", extra=self._detail())
            self.stalled_since = None

    def _detail(self) -> dict:
        now = self.clock()
        watch = self.watch
        return {
            "stt_stream": self.stream,
            "frames_forwarded": self.frames,
            "last_frame_age": round(now - self.last_frame_at, 2) if self.last_frame_at is not None else None,
            "last_result_age": round(now - watch.progress_at, 2) if watch.progress_at is not None else None,
            "interims": self.interims,
            "finals": self.finals,
            "user_speaking": watch.speaking,
            "awaiting_final": watch.awaiting_final,
            "stalled_for": round(now - self.stalled_since, 2) if self.stalled_since is not None else 0.0,
        }

    def check(self) -> bool:
        """Log once when owed speech gets no recognizer progress; returns whether it is currently stalled."""
        if not self.watch.stalled():
            return False
        if self.stalled_since is None:
            self.stalled_since = self.clock()
            self.log.warning("Elevate recognizer returned nothing for detected speech", extra=self._detail())
        return True

    async def run(self, interval: float = CHECK_INTERVAL_SECONDS) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                self.check()
            except Exception as err:  # diagnostics must never affect the session
                self.log.debug("Elevate recognizer check failed: %s", type(err).__name__)
