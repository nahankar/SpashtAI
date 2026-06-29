"""
Live Pacing Tracker
─────────────────────────────────────────────────────────────────────────────
Measures the user's real speaking pace (words-per-minute) during an Elevate
session, grounded in two LiveKit AgentSession signals:

  1. `user_state_changed` (UserState: speaking | listening | away)
        → tells us when the user starts/stops speaking, which gives us a
          measured speaking duration per utterance (no STT timestamps needed).

  2. `user_input_transcribed` (is_final=True)
        → gives us the word count for the just-completed utterance.

Pairing those two signals lets us compute *real* WPM instead of the previous
tautological calculation that always returned exactly 150.

Two consumers:

  • `get_live_metrics()` is exposed to the LLM as a `function_tool` so the
     coach can cite a *measured* number when discussing pacing.

  • `get_session_totals()` is read by `metrics_collector` at session end to
     populate the post-session dashboard with the correct value.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque

logger = logging.getLogger("live-pacing")

# Tunable thresholds
_MIN_SPEECH_SEC = 0.4   # ignore VAD blips shorter than this
_MIN_WORDS_FOR_WPM = 5  # don't report WPM until the user has said at least this many words
_DURATION_QUEUE_MAX = 32


def _qualitative_pace(wpm: float) -> str:
    if wpm <= 0:
        return "no-speech-yet"
    if wpm < 100:
        return "slow"
    if wpm < 120:
        return "measured"
    if wpm <= 160:
        return "ideal"
    if wpm <= 180:
        return "fast"
    return "rapid"


@dataclass
class _PendingDuration:
    seconds: float
    started_at: float


@dataclass
class UtteranceSnapshot:
    """Metrics for the most recently finalized user utterance."""
    words: int
    seconds: float
    wpm: float
    qualitative: str


@dataclass
class LivePacingSnapshot:
    """Immutable snapshot returned from the tracker."""
    wpm: float
    total_words: int
    total_speaking_seconds: float
    samples: int
    qualitative: str
    ideal_range_wpm: str = "120-160"

    def to_dict(self) -> dict:
        return {
            "wpm": round(self.wpm, 1),
            "total_words": self.total_words,
            "total_speaking_seconds": round(self.total_speaking_seconds, 1),
            "samples": self.samples,
            "qualitative": self.qualitative,
            "ideal_range_wpm": self.ideal_range_wpm,
        }


class LivePacingTracker:
    """
    Thread-safe accumulator of user speaking-time and word-count, populated
    from LiveKit session events.

    State machine (per utterance):

        UserState transition `→ speaking`     ──► record start_time
        UserState transition `→ !speaking`    ──► duration = now - start_time
                                                  push to pending queue
        user_input_transcribed (is_final)     ──► pop pending duration,
                                                  attribute words to it.

    The pending queue handles the race where the transcript arrives slightly
    after the state change (the common case) AND the rarer case where two
    speech segments are coalesced by STT into a single transcript.
    """

    _WORD_RE = re.compile(r"[A-Za-z']+(?:[-'][A-Za-z']+)?")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._user_speaking_started_at: float | None = None
        self._pending: Deque[_PendingDuration] = deque(maxlen=_DURATION_QUEUE_MAX)
        self._total_words: int = 0
        self._total_seconds: float = 0.0
        self._samples: int = 0
        # Dedup guard — same final transcript can arrive on both
        # `user_input_transcribed` and `conversation_item_added`. We hash
        # the last accepted text so double-fires are silently dropped.
        self._last_accepted_hash: int | None = None
        self._last_utterance: UtteranceSnapshot | None = None
        # Set once the STT stream delivers real word/segment timestamps
        # (AWS Transcribe). When active, the VAD-paired `on_user_transcript`
        # accumulation is suppressed so the two sources never double-count and
        # so we never fall back to the 150-WPM estimate.
        self._word_timing_active: bool = False

    # ── Event hooks ──────────────────────────────────────────────────────

    def on_user_state_changed(self, new_state: str) -> None:
        """Wire to: `session.on("user_state_changed", lambda ev: tracker.on_user_state_changed(ev.new_state))`"""
        now = time.monotonic()
        with self._lock:
            if new_state == "speaking":
                # If we somehow get a second `speaking` without a prior end,
                # just reset the start time (last-writer-wins).
                self._user_speaking_started_at = now
            else:  # "listening" | "away" | anything else
                if self._user_speaking_started_at is not None:
                    duration = now - self._user_speaking_started_at
                    self._user_speaking_started_at = None
                    if duration >= _MIN_SPEECH_SEC:
                        self._pending.append(_PendingDuration(seconds=duration, started_at=now - duration))

    def on_user_transcript(self, transcript: str, is_final: bool) -> None:
        """Hook for finalized user transcripts.

        Wire to BOTH `user_input_transcribed` (preferred when STT plugin emits
        it) and `conversation_item_added` (the reliably-firing event in
        pipeline mode) — the dedup guard makes it safe to call twice with
        the same text.
        """
        if not is_final:
            return
        if self._word_timing_active:
            # Real STT timestamps are driving pacing — ignore the VAD-paired
            # path to avoid double-counting and the 150-WPM estimate fallback.
            return
        text = (transcript or "").strip()
        if not text:
            return

        text_hash = hash(text)
        words = len(self._WORD_RE.findall(text))
        if words == 0:
            return

        with self._lock:
            # Drop exact-duplicate finals from the second event source.
            if self._last_accepted_hash == text_hash:
                logger.debug("live-pacing: dedup-dropped duplicate final transcript")
                return
            self._last_accepted_hash = text_hash

            # Pair transcript to the oldest pending completed duration (FIFO).
            if self._pending:
                duration = self._pending.popleft().seconds
            else:
                # Fallback: estimate at 150 WPM. Used when the state-change
                # event is missed (rare). This still gives a meaningful WPM
                # signal even if VAD events don't fire.
                duration = max(words / 2.5, _MIN_SPEECH_SEC)
                logger.debug("live-pacing: no pending duration; estimating %.2fs for %d words", duration, words)

            self._total_words += words
            self._total_seconds += duration
            self._samples += 1
            utterance_wpm = (words / duration) * 60 if duration > 0 else 0.0
            self._last_utterance = UtteranceSnapshot(
                words=words,
                seconds=duration,
                wpm=utterance_wpm,
                qualitative=_qualitative_pace(utterance_wpm),
            )
            logger.info(
                "🗣️  live-pacing: +%d words in %.2fs (cum %d words / %.2fs / %.1f WPM)",
                words, duration, self._total_words, self._total_seconds,
                (self._total_words / self._total_seconds) * 60 if self._total_seconds > 0 else 0.0,
            )

    def ingest_measured_final(self, text: str, words: int, seconds: float | None) -> None:
        """Authoritative pacing from real STT word/segment timestamps.

        `seconds` is the measured speech span (segment end - start) from AWS
        Transcribe. Unlike `on_user_transcript`, this never estimates: if no
        valid duration is present the segment is skipped rather than guessed.
        Once any measured segment lands, the VAD-paired path is suppressed.
        """
        text = (text or "").strip()
        if not text or words <= 0:
            return
        if seconds is None or seconds <= 0:
            return
        text_hash = hash(text)
        with self._lock:
            self._word_timing_active = True
            if self._last_accepted_hash == text_hash:
                logger.debug("live-pacing: dedup-dropped duplicate measured final")
                return
            self._last_accepted_hash = text_hash

            self._total_words += words
            self._total_seconds += seconds
            self._samples += 1
            utterance_wpm = (words / seconds) * 60 if seconds > 0 else 0.0
            self._last_utterance = UtteranceSnapshot(
                words=words,
                seconds=seconds,
                wpm=utterance_wpm,
                qualitative=_qualitative_pace(utterance_wpm),
            )
            logger.info(
                "⏱️  live-pacing(measured): +%d words in %.2fs (cum %d words / %.2fs / %.1f WPM)",
                words, seconds, self._total_words, self._total_seconds,
                (self._total_words / self._total_seconds) * 60 if self._total_seconds > 0 else 0.0,
            )

    # ── Read APIs ────────────────────────────────────────────────────────

    def get_live_metrics(self) -> LivePacingSnapshot:
        """LLM-facing snapshot — used by the `get_live_pacing` function tool."""
        with self._lock:
            if self._total_words < _MIN_WORDS_FOR_WPM or self._total_seconds <= 0:
                return LivePacingSnapshot(
                    wpm=0.0,
                    total_words=self._total_words,
                    total_speaking_seconds=self._total_seconds,
                    samples=self._samples,
                    qualitative="not-enough-data",
                )
            wpm = (self._total_words / self._total_seconds) * 60
            return LivePacingSnapshot(
                wpm=wpm,
                total_words=self._total_words,
                total_speaking_seconds=self._total_seconds,
                samples=self._samples,
                qualitative=_qualitative_pace(wpm),
            )

    def get_session_totals(self) -> tuple[int, float, int]:
        """(total_words, total_speaking_seconds, samples) — for end-of-session metrics save."""
        with self._lock:
            return self._total_words, self._total_seconds, self._samples

    def peek_last_utterance(self) -> UtteranceSnapshot | None:
        with self._lock:
            return self._last_utterance

    def reset(self) -> None:
        with self._lock:
            self._user_speaking_started_at = None
            self._pending.clear()
            self._total_words = 0
            self._total_seconds = 0.0
            self._samples = 0
            self._last_utterance = None
            self._last_accepted_hash = None
            self._word_timing_active = False
