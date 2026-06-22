"""
Per-turn and session turn-stitching helpers.

Mirrors the frontend `groupConsecutive` logic (same role + ≤90s gap → one turn).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Callable, Optional, Tuple

STITCH_GAP_SEC = 90.0

FILLER_WORDS = {
    "um", "uh", "er", "ah", "like", "you know", "so", "well", "actually",
    "basically", "literally", "right", "okay", "yeah", "hmm", "mmm",
}

HEDGING_RE = re.compile(
    r"\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|"
    r"i suppose|it seems|i feel like|not sure|might|could be|possibly|"
    r"a little|somewhat|i believe)\b",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"[A-Za-z']+(?:[-'][A-Za-z']+)?")

CommittedTurn = Tuple[str, str, Optional["TurnMetricsSnapshot"]]


@dataclass
class TurnMetricsSnapshot:
    word_count: int
    filler_count: int
    filler_rate: float
    hedging_count: int
    wpm: Optional[float] = None
    speaking_seconds: Optional[float] = None
    qualitative_pace: Optional[str] = None
    coaching_tip: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def _extract_words(text: str) -> list[str]:
    return _WORD_RE.findall(text)


def _qualitative_pace(wpm: float) -> str:
    if wpm <= 0:
        return "not-enough-data"
    if wpm < 100:
        return "slow"
    if wpm < 120:
        return "measured"
    if wpm <= 160:
        return "ideal"
    if wpm <= 180:
        return "fast"
    return "rapid"


def compute_turn_metrics(
    text: str,
    *,
    utterance_words: Optional[int] = None,
    utterance_seconds: Optional[float] = None,
    utterance_wpm: Optional[float] = None,
) -> TurnMetricsSnapshot:
    words = _extract_words(text)
    word_count = len(words)
    fillers = [w for w in words if w.lower() in FILLER_WORDS]
    filler_count = len(fillers)
    filler_rate = (filler_count / word_count * 100) if word_count else 0.0
    hedging_count = len(HEDGING_RE.findall(text))

    wpm: Optional[float] = None
    speaking_seconds: Optional[float] = None
    qualitative: Optional[str] = None

    if utterance_wpm and utterance_words and utterance_seconds:
        if utterance_words > 0 and abs(utterance_words - word_count) <= max(5, word_count * 0.15):
            wpm = round(utterance_wpm, 1)
            speaking_seconds = round(utterance_seconds, 1)
            qualitative = _qualitative_pace(wpm)
    if wpm is None and word_count >= 3:
        speaking_seconds = max(word_count / 2.5, 0.4)
        wpm = round((word_count / speaking_seconds) * 60, 1)
        qualitative = _qualitative_pace(wpm)

    tip = _coaching_tip(filler_rate, hedging_count, wpm or 0, qualitative or "")

    return TurnMetricsSnapshot(
        word_count=word_count,
        filler_count=filler_count,
        filler_rate=round(filler_rate, 1),
        hedging_count=hedging_count,
        wpm=wpm,
        speaking_seconds=speaking_seconds,
        qualitative_pace=qualitative,
        coaching_tip=tip,
    )


def _coaching_tip(filler_rate: float, hedging_count: int, wpm: float, qualitative: str) -> str:
    if hedging_count >= 2:
        return "Reduce hedging — state recommendations directly without 'I think' or 'maybe'."
    if filler_rate >= 8:
        return "Try a brief pause instead of filler words on this turn."
    if qualitative in ("fast", "rapid"):
        return "This turn was fast — add a pause before key points."
    if qualitative == "slow":
        return "Pick up energy slightly while keeping clarity."
    if qualitative == "ideal":
        return "Strong pacing on this turn — keep that rhythm."
    return "Focus on one clear point per sentence."


class TurnStitcher:
    """Accumulate STT/LLM fragments into logical conversational turns."""

    def __init__(
        self,
        metrics_for_user: Callable[[str, object], TurnMetricsSnapshot],
    ) -> None:
        self._metrics_for_user = metrics_for_user
        self._pending_speaker: Optional[str] = None
        self._pending_text: str = ""
        self._pending_timestamp: float = 0.0
        self._last_fragment_hash: Optional[int] = None

    def ingest(self, speaker: str, text: str, timestamp: float) -> list[CommittedTurn]:
        """Returns zero or one committed turns when speaker/gap boundary crossed."""
        text = (text or "").strip()
        if len(text) < 3 or speaker not in ("user", "assistant"):
            return []

        frag_hash = hash(text)
        if frag_hash == self._last_fragment_hash:
            return []
        self._last_fragment_hash = frag_hash

        committed: list[CommittedTurn] = []

        if self._pending_speaker is None:
            self._pending_speaker = speaker
            self._pending_text = text
            self._pending_timestamp = timestamp
            return committed

        same_role = self._pending_speaker == speaker
        gap_ok = (timestamp - self._pending_timestamp) <= STITCH_GAP_SEC

        if same_role and gap_ok:
            self._merge_fragment(text)
            self._pending_timestamp = timestamp
            return committed

        turn = self._finalize_pending()
        if turn:
            committed.append(turn)
        self._pending_speaker = speaker
        self._pending_text = text
        self._pending_timestamp = timestamp
        return committed

    def flush(self) -> list[CommittedTurn]:
        turn = self._finalize_pending()
        self._pending_speaker = None
        self._pending_text = ""
        self._pending_timestamp = 0.0
        return [turn] if turn else []

    def _merge_fragment(self, text: str) -> None:
        if text.startswith(self._pending_text) or (
            self._pending_text and self._pending_text in text and len(text) > len(self._pending_text)
        ):
            self._pending_text = text
            return
        if self._pending_text.startswith(text):
            return
        self._pending_text = f"{self._pending_text} {text}".replace("  ", " ").strip()

    def _finalize_pending(self) -> Optional[CommittedTurn]:
        if not self._pending_speaker or not self._pending_text.strip():
            return None
        speaker = self._pending_speaker
        text = self._pending_text.strip()
        user_metrics = None
        if speaker == "user":
            user_metrics = self._metrics_for_user(text, None)
        return (speaker, text, user_metrics)
