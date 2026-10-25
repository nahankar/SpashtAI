"""Keep interview-only streaming STT alive while user audio is detached.

Silence is sent to the recognizer only; it never becomes an answer, a recording
or a voice-activity event. Real microphone frames retain their original order.
"""
import asyncio
from collections.abc import AsyncIterable, AsyncIterator
from livekit import rtc

INTERVIEW_SAMPLE_RATE = 16000


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
