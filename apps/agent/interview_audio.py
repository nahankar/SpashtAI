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
# (AWS_ERROR_HTTP_STREAM_HAS_COMPLETED surfaces only later), including in the middle of an utterance after
# earlier results. Partial results normally follow speech within about a second and keep coming while words
# are spoken, so voiced input (or an unfinished partial) with no recognizer progress for this long means the
# stream has stopped.
STALL_SECONDS = 6.0
MIN_VOICED_SECONDS = 1.5      # voiced input owed a result once speech ends (shorter sounds may be noise)
MAX_STALL_SECONDS = 30.0      # backoff ceiling while replacements keep stalling
FAILED_AFTER_RESTARTS = 2     # consecutive replacements without progress before the learner is told
REPLAY_SECONDS = 20.0         # unrecognised audio resent to the replacement stream (bounded)
REPLAY_MARGIN_SECONDS = 0.3   # voice activity starts slightly after the first voiced audio
COMMITTED_MARGIN_SECONDS = 0.1  # resume just after the last committed word, never inside it
REPLAY_SPEED = 2.0

logger = logging.getLogger("spashtai-agent.interview_audio")


class RecognizerWatch:
    """Recognizer progress against voiced input: notices a stream that stops responding, even mid-utterance.

    A result is owed while the learner keeps speaking (timed from the later of the speech start and the last
    result), while a partial result has no final yet (timed from that partial), or once at least
    MIN_VOICED_SECONDS of speech since the last result has had none (timed from that speech). Silence, or a short
    sound such as a cough, is owed nothing.
    """

    def __init__(self, stall: float = STALL_SECONDS, min_voiced: float = MIN_VOICED_SECONDS,
                 clock: Callable[[], float] = time.time):
        self.base_stall, self.min_voiced, self.clock = stall, min_voiced, clock
        self.reset()

    def reset(self) -> None:
        self.stall = self.base_stall
        self.speaking = False
        self.speech_at: float | None = None        # current voiced run, or the last result during it
        self.voiced = 0.0                          # finished voiced seconds since the last result
        self.voiced_since: float | None = None     # first voiced audio since the last result
        self.progress_at: float | None = None      # latest interim or final
        self.awaiting_final = False                # a partial result has no final yet
        self.committed_until: float | None = None  # wall-clock end of audio covered by the latest final
        self.first_voiced: float | None = None     # first voiced audio after the latest final
        self.restart_at: float | None = None       # each replacement gets its own full window
        self.restarts = 0                          # consecutive replacements without progress

    def new_stream(self) -> None:
        """A new recognizer stream (session start or a question change): forget recognizer progress, but keep
        the voice-activity state, which belongs to the session and may already say the learner is speaking."""
        speaking = self.speaking
        self.reset()
        if speaking:
            self.speech_started()

    def speech_started(self, at: float | None = None) -> None:
        at = at if at is not None else self.clock()
        self.speaking, self.speech_at = True, at
        if self.voiced_since is None:
            self.voiced_since = at
        if self.first_voiced is None:
            self.first_voiced = at

    def speech_ended(self, at: float | None = None) -> None:
        if self.speaking and self.speech_at is not None:
            self.voiced += max(0.0, (at if at is not None else self.clock()) - self.speech_at)
        self.speaking = False

    def result(self, final: bool, covered_until: float | None = None) -> None:
        """Any interim or final is progress; a final also commits the audio it covers."""
        now = self.clock()
        self.progress_at = now
        self.voiced, self.restarts, self.stall = 0.0, 0, self.base_stall
        self.speech_at = now if self.speaking else None
        self.voiced_since = now if self.speaking else None
        self.awaiting_final = not final
        if final:
            self.committed_until = max(self.committed_until or 0.0, covered_until if covered_until is not None else now)
            self.first_voiced = now if self.speaking else None

    def _owed_since(self, now: float) -> list[float]:
        owed = []
        if self.speaking and self.speech_at is not None:
            owed.append(self.speech_at)
        if self.awaiting_final and self.progress_at is not None:
            owed.append(self.progress_at)
        running = now - self.speech_at if self.speaking and self.speech_at is not None else 0.0
        if self.voiced + running >= self.min_voiced and self.voiced_since is not None:
            owed.append(self.voiced_since)
        return [max(at, self.restart_at) if self.restart_at is not None else at for at in owed]

    def stalled(self) -> bool:
        now = self.clock()
        return any(now - at >= self.stall for at in self._owed_since(now))

    def replay_from(self) -> float:
        """Where the replacement should start: just after committed words, else at the first unrecognised speech."""
        if self.committed_until is not None:
            return self.committed_until + COMMITTED_MARGIN_SECONDS
        anchor = self.first_voiced if self.first_voiced is not None else self.voiced_since
        return (anchor if anchor is not None else self.clock()) - REPLAY_MARGIN_SECONDS

    def restarted(self) -> None:
        """Give the replacement its own window; back off while replacements keep failing."""
        self.restarts += 1
        self.stall = min(self.base_stall * (2 ** self.restarts), MAX_STALL_SECONDS)
        self.restart_at = self.clock()

    @property
    def failing(self) -> bool:
        return self.restarts >= FAILED_AFTER_RESTARTS


async def supervise_recognizer(audio: AsyncIterable[rtc.AudioFrame], open_stream: Callable[[AsyncIterable[rtc.AudioFrame]], AsyncIterable],
                               watch: RecognizerWatch, on_open: Callable[[float], None], *, poll: float = .25,
                               replay: float = REPLAY_SECONDS, clock: Callable[[], float] = time.time,
                               on_issue: Callable[[str, dict], None] = lambda kind, detail: None) -> AsyncIterator:
    """Run one recognizer stream over `audio`, replacing it when it stalls, fails or ends early.

    The replacement first receives the audio heard after the last committed words (at most `replay` seconds, at
    twice real time), so speech during a short stall is recognised once and in order. `on_open` receives the
    wall-clock time of each stream's first frame. `on_issue` reports 'restarted' (with replayed and lost
    seconds), 'unavailable' after repeated failures, and 'recovered' at the first result after a restart.
    Closing the iterator (question change, teardown) discards the buffer, so no audio crosses answers.
    """
    history: deque = deque()  # (wall time, frame) for the last `replay` seconds
    queue: asyncio.Queue = asyncio.Queue()
    dropped = {"until": None}  # time of the newest frame pushed out of the bounded buffer

    async def pump():
        try:
            async for frame in audio:
                now = clock()
                history.append((now, frame))
                while history and now - history[0][0] > replay:
                    dropped["until"] = history.popleft()[0]
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
    reported = False
    try:
        on_open(clock())
        while True:
            events = open_stream(feed(queue, replayed)).__aiter__()
            reason = None
            while reason is None:
                upcoming = asyncio.ensure_future(anext(events))
                while not (await asyncio.wait({upcoming}, timeout=poll))[0]:
                    if watch.stalled():
                        reason = "no_result_while_speaking"
                        upcoming.cancel()
                        await asyncio.gather(upcoming, return_exceptions=True)
                        break
                if reason is not None:
                    break
                try:
                    event = upcoming.result()
                except StopAsyncIteration:
                    if pumping.done():
                        return  # the audio ended (teardown or question change): nothing to recover
                    reason = "stream_ended"
                    break
                except Exception as error:
                    reason = f"stream_error:{type(error).__name__}"
                    break
                yield event
                # The consumer records progress on the watch while handling the event.
                if reported and watch.restarts == 0:
                    reported = False
                    on_issue("recovered", {})
            # Swap streams without awaiting, so every later frame reaches the replacement.
            since = watch.replay_from()
            old, queue = queue, asyncio.Queue()
            replayed = [frame for at, frame in history if at >= since]
            first = next((at for at, _ in history if at >= since), clock())
            # Audio older than the buffer bound is not resent (it stays in the recording, untranscribed).
            lost = max(0.0, dropped["until"] - since) if dropped["until"] is not None and dropped["until"] > since else 0.0
            old.put_nowait(None)
            watch.restarted()
            logger.warning("interview_stt restarted reason=%s attempt=%d replay_s=%.1f lost_s=%.1f",
                           reason, watch.restarts, clock() - first if replayed else 0.0, lost)
            on_issue("restarted", {"reason": reason, "replayedSeconds": round(clock() - first, 1) if replayed else 0.0,
                                   "lostSeconds": round(lost, 1)})
            if watch.failing and not reported:
                reported = True
                on_issue("unavailable", {"reason": reason})
            on_open(first)
            with contextlib.suppress(Exception):
                await events.aclose()
            if reason.startswith("stream_") and watch.restarts > 1:
                # A stream that fails at once again (for example credentials) is retried with backoff, not in a loop.
                await asyncio.sleep(min(.5 * 2 ** (watch.restarts - 1), 5.0))
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
