"""Keep interview-only streaming STT alive while user audio is detached.

Silence is sent to the recognizer only; it never becomes an answer, a recording
or a voice-activity event. Real microphone frames retain their original order.
"""
import asyncio
import contextlib
import logging
import time
from collections import deque
from collections.abc import AsyncIterable, AsyncIterator, Callable
from livekit import rtc

INTERVIEW_SAMPLE_RATE = 16000
# Amazon Transcribe streams can stop returning results without an error reaching the plugin for minutes
# (AWS_ERROR_HTTP_STREAM_HAS_COMPLETED surfaces only later). Partial results normally follow speech within
# about a second, so voice activity with no result of any kind for this long means the stream has stopped.
STALL_SECONDS = 6.0
REPLAY_SECONDS = 20.0         # unrecognised audio resent to the replacement stream (bounded)
REPLAY_MARGIN_SECONDS = 0.3   # voice activity starts slightly after the first voiced audio
REPLAY_SPEED = 2.0

logger = logging.getLogger("spashtai-agent.interview_audio")


class RecognizerWatch:
    """Notices voice activity that no recognizer result has followed."""

    def __init__(self, stall: float = STALL_SECONDS, clock: Callable[[], float] = time.time):
        self.stall, self.clock = stall, clock
        self.unanswered_since: float | None = None

    def reset(self) -> None:
        self.unanswered_since = None

    def speech_started(self, at: float | None = None) -> None:
        if self.unanswered_since is None:
            self.unanswered_since = at if at is not None else self.clock()

    def result(self) -> None:
        self.unanswered_since = None

    def stalled(self) -> bool:
        return self.unanswered_since is not None and self.clock() - self.unanswered_since >= self.stall


async def supervise_recognizer(audio: AsyncIterable[rtc.AudioFrame], open_stream: Callable[[AsyncIterable[rtc.AudioFrame]], AsyncIterable],
                               watch: RecognizerWatch, on_open: Callable[[float], None], *, poll: float = .25,
                               replay: float = REPLAY_SECONDS, clock: Callable[[], float] = time.time) -> AsyncIterator:
    """Run one recognizer stream over `audio`, replacing it when `watch` reports a stall.

    The replacement first receives the audio heard since the unanswered speech began, so nothing said
    during the stall is lost; `on_open` receives the wall-clock time of the first frame each stream gets.
    """
    history: deque = deque()  # (wall time, frame) for the last `replay` seconds
    queue: asyncio.Queue = asyncio.Queue()

    async def pump():
        try:
            async for frame in audio:
                now = clock()
                history.append((now, frame))
                while history and now - history[0][0] > replay:
                    history.popleft()
                queue.put_nowait(frame)
        finally:
            queue.put_nowait(None)

    def feed(source: asyncio.Queue, replayed=()) -> AsyncIterator[rtc.AudioFrame]:
        async def frames():
            # Streaming recognizers expect near real-time input: resend held audio at twice real time.
            for frame in replayed:
                yield frame
                await asyncio.sleep(frame.duration / REPLAY_SPEED)
            while (frame := await source.get()) is not None:
                yield frame
        return frames()

    pumping = asyncio.create_task(pump())
    events = None
    replayed: list = []
    try:
        on_open(clock())
        while True:
            events = open_stream(feed(queue, replayed)).__aiter__()
            while True:
                upcoming = asyncio.ensure_future(anext(events))
                stalled = False
                while not (await asyncio.wait({upcoming}, timeout=poll))[0]:
                    if watch.stalled():
                        stalled = True
                        break
                if stalled:
                    upcoming.cancel()
                    await asyncio.gather(upcoming, return_exceptions=True)
                    break
                try:
                    event = upcoming.result()
                except StopAsyncIteration:
                    return
                yield event
            # Swap streams without awaiting, so every later frame reaches the replacement.
            since = watch.unanswered_since - REPLAY_MARGIN_SECONDS
            watch.reset()
            old, queue = queue, asyncio.Queue()
            replayed = [frame for at, frame in history if at >= since]
            first = next((at for at, _ in history if at >= since), clock())
            old.put_nowait(None)
            logger.warning("interview_stt restarted reason=no_result_after_speech replay_s=%.1f", clock() - first)
            on_open(first)
            with contextlib.suppress(Exception):
                await events.aclose()
    finally:
        pumping.cancel()
        await asyncio.gather(pumping, return_exceptions=True)
        if events is not None:
            with contextlib.suppress(Exception):
                await events.aclose()


class ProviderClock:
    """Maps one recognizer stream's audio timestamps to wall-clock time.

    LiveKit adds the stream's start_time_offset to provider times and also records it on each word, so the
    stream opened at about `opened - start_time_offset` on the shared timeline. Audio reaches the recognizer
    in real time (silence keeps flowing while input is detached), so an audio timestamp maps to the
    wall-clock moment it was spoken. Until a result with words names the offset, results are untimed.
    """

    def __init__(self, opened: float):
        self.opened = opened
        self.anchor = None

    def timing(self, alternative) -> dict:
        words = getattr(alternative, "words", None) or []
        offset = getattr(words[0], "start_time_offset", None) if words else None
        if self.anchor is None and isinstance(offset, (int, float)):
            self.anchor = self.opened - offset
        if self.anchor is None:
            return {}
        last = getattr(words[-1], "end_time", None) if words else None
        return {"start": self.anchor + alternative.start_time, "end": self.anchor + alternative.end_time,
                "word_end": self.anchor + last if isinstance(last, (int, float)) else None}

async def keep_interview_audio_alive(audio: AsyncIterable[rtc.AudioFrame], interval: float = .1) -> AsyncIterator[rtc.AudioFrame]:
    iterator = audio.__aiter__()
    pending = None
    samples = max(1, round(INTERVIEW_SAMPLE_RATE * interval))
    silence = rtc.AudioFrame(bytes(samples * 2), INTERVIEW_SAMPLE_RATE, 1, samples)
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(anext(iterator))
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield silence
                continue
            try:
                frame = pending.result()
            except StopAsyncIteration:
                return
            pending = None
            # RoomOptions fixes the interview input format before this node.
            if frame.sample_rate != INTERVIEW_SAMPLE_RATE or frame.num_channels != 1:
                raise ValueError('Interview STT requires 16 kHz mono audio')
            yield frame
    finally:
        if pending is not None:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
