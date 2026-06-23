"""
Shared filler / hedging / acknowledgment detection for live coaching metrics.

Aligned with apps/agent/analytics/text_signals.py — acknowledgments (okay, yeah)
are tracked separately from true fillers (um, uh, discourse 'like', etc.).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

SpanKind = Literal["filler", "hedging", "acknowledgment"]

# True fillers — disfluencies and discourse padding
_SINGLE_FILLER_RE = re.compile(
    r"\b(?:um|uh|umm|uhh|er|ah|hmm|mmm|basically|actually|literally|"
    r"you know|i mean)\b",
    re.IGNORECASE,
)
_LIKE_FILLER_RE = re.compile(r"\blike\b", re.IGNORECASE)
# Lexical "like" (would like, looks like) — not discourse filler "like".
_LIKE_NOT_FILLER_BEFORE = re.compile(
    r"\b(?:"
    r"(?:i|we|they|he|she|it|you|i'd|we'd|they'd)\s+|"
    r"would\s+|looks?\s+|feels?\s+|felt\s+|something\s+"
    r")$",
    re.IGNORECASE,
)

# Short responses / backchannels — softer signal, not counted in strict filler total
ACKNOWLEDGMENT_RE = re.compile(
    r"\b(?:ok|okay|yeah|yep|yup|right|so|well|sure|mhm|got it|i see)\b",
    re.IGNORECASE,
)

HEDGING_RE = re.compile(
    r"\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|"
    r"i suppose|it seems|i feel like|not sure|might|could be|possibly|"
    r"a little|somewhat|i believe)\b",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"[A-Za-z']+(?:[-'][A-Za-z']+)?")


@dataclass
class SpeechCounts:
    filler_count: int
    acknowledgment_count: int
    hedging_count: int
    word_count: int

    @property
    def filler_rate(self) -> float:
        return (self.filler_count / self.word_count * 100) if self.word_count else 0.0


def count_words(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


def _count_like_fillers(text: str) -> int:
    count = 0
    for m in _LIKE_FILLER_RE.finditer(text):
        before = text[: m.start()]
        if _LIKE_NOT_FILLER_BEFORE.search(before):
            continue
        count += 1
    return count


def analyze_speech_text(text: str) -> SpeechCounts:
    normalized = text or ""
    wc = count_words(normalized)
    filler_count = len(_SINGLE_FILLER_RE.findall(normalized)) + _count_like_fillers(normalized)
    return SpeechCounts(
        filler_count=filler_count,
        acknowledgment_count=len(ACKNOWLEDGMENT_RE.findall(normalized)),
        hedging_count=len(HEDGING_RE.findall(normalized)),
        word_count=wc,
    )


def unique_vocab_ratio(text: str) -> float:
    words = [w.lower() for w in _WORD_RE.findall(text or "") if len(w) > 2]
    return round(len(set(words)) / len(words), 3) if words else 0.0
