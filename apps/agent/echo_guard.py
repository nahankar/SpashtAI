"""Detect user STT transcripts that are likely coach-speaker echo."""

from __future__ import annotations

import difflib
import re
import time

# Acoustic echo (mic picking up coach TTS) is a near-real-time event and shows up
# as a near-VERBATIM, LONG copy of the coach's line — not a few words a user
# naturally reuses when answering ("Are you ready to begin?" → "Yes, I'm ready to
# begin"). Client-side WebRTC AEC already cancels most echo, so this text guard is
# a last resort and must err toward NOT rejecting real user speech.
_ECHO_WINDOW_SEC = 20.0
_ECHO_RATIO_THRESHOLD = 0.8
_MIN_SHARED_PHRASE_WORDS = 6
# A long verbatim run only counts as echo when it reproduces MOST of the coach's
# line — i.e. the mic copied the utterance. A user naturally repeating a handful
# of the coach's words (e.g. echoing the prompt back: coach says "your core
# passion is technology, especially AI" → user answers "my core passion is
# technology, especially AI") covers only a small fraction of the coach line and
# must pass through as a real turn.
_ECHO_COVERAGE_THRESHOLD = 0.6


def _normalize(text: str) -> str:
    cleaned = re.sub(r"[^\w\s']", " ", (text or "").lower())
    return " ".join(cleaned.split())


def _longest_shared_phrase_words(user_norm: str, assistant_norm: str) -> int:
    user_words = user_norm.split()
    assistant_words = assistant_norm.split()
    if not user_words or not assistant_words:
        return 0
    best = 0
    max_n = min(len(user_words), len(assistant_words))
    for n in range(max_n, _MIN_SHARED_PHRASE_WORDS - 1, -1):
        for i in range(len(user_words) - n + 1):
            phrase = " ".join(user_words[i : i + n])
            if phrase in assistant_norm:
                return n
        for i in range(len(assistant_words) - n + 1):
            phrase = " ".join(assistant_words[i : i + n])
            if phrase in user_norm:
                return n
    return best


def record_assistant_speech(
    history: list[tuple[str, float]],
    text: str,
    *,
    now: float | None = None,
) -> None:
    """Remember recent coach lines for echo comparison."""
    normalized = (text or "").strip()
    if len(normalized) < 8:
        return
    ts = now if now is not None else time.time()
    history.append((normalized, ts))
    cutoff = ts - _ECHO_WINDOW_SEC
    pruned = [(t, t_ts) for t, t_ts in history if t_ts >= cutoff]
    history.clear()
    history.extend(pruned[-6:])


def is_likely_echo(
    user_text: str,
    assistant_history: list[tuple[str, float]],
    *,
    now: float | None = None,
) -> bool:
    """True when user_text probably came from the mic picking up coach TTS."""
    user_norm = _normalize(user_text)
    if len(user_norm) < 8:
        return False

    ts = now if now is not None else time.time()
    recent = [(t, t_ts) for t, t_ts in assistant_history if ts - t_ts <= _ECHO_WINDOW_SEC]
    if not recent:
        return False

    for assistant_text, _ in recent:
        assistant_norm = _normalize(assistant_text)
        if not assistant_norm:
            continue
        assistant_word_count = len(assistant_norm.split())

        # Whole utterance is a near-verbatim copy of a coach line — the strongest
        # echo signal and what acoustic echo of a short coach line looks like.
        ratio = difflib.SequenceMatcher(None, user_norm, assistant_norm).ratio()
        if ratio >= _ECHO_RATIO_THRESHOLD:
            return True

        # A long verbatim run shared with the coach that ALSO reproduces most of
        # the coach's line. This catches the mic copying a (possibly long) coach
        # utterance, while letting a user who reuses a few of the coach's words
        # pass through — that run covers only a small fraction of the coach line.
        shared = _longest_shared_phrase_words(user_norm, assistant_norm)
        if (
            shared >= _MIN_SHARED_PHRASE_WORDS
            and assistant_word_count > 0
            and shared / assistant_word_count >= _ECHO_COVERAGE_THRESHOLD
        ):
            return True

    return False
