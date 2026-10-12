"""Keep interview-only streaming STT alive while user audio is detached.

Silence is sent to the recognizer only; it never becomes an answer, a recording
or a voice-activity event. Real microphone frames retain their original order.
"""
import asyncio
from collections.abc import AsyncIterable, AsyncIterator
from livekit import rtc

INTERVIEW_SAMPLE_RATE = 16000

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
