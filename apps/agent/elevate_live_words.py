"""Bounded, source-only live STT evidence for Elevate (not Replay).

Integration: in the public Agent.stt_node override, iterate
Agent.default.stt_node(self, audio, model_settings), ingest each event, and
yield it unchanged. Attach for_turns(committed_turns)[i] under that turn's
metrics.live_word_evidence. This module neither gates sessions nor mutates turns.

LiveKit agents/AWS 1.5.8 exposes SpeechData.words as
livekit.agents.types.TimedString: str(word), start_time, end_time, confidence,
and start_time_offset. AWS already adds the offset to both endpoints; never
add it again. AWS retains item timing/confidence but does not propagate AWS
result_id/session_id into SpeechEvent. Its missing item confidence becomes
0.0, indistinguishable from a genuine zero; omit that ambiguous SDK value.
Explicit confidence in sanitized dictionaries is preserved, including zero.
UserInputTranscribedEvent retains
only text, not words. No arrival time or SDK offset anchors browser audio.

ingest accepts public SDK objects or sanitized dict/object equivalents:
type="final_transcript", alternatives=[{text, words, start_time?, end_time?}].
Words may be TimedString or {w/word/text, start/start_time, end/end_time,
recognitionConfidence/confidence?}. Text-only finals may use is_final=True
and text/transcript. Explicit stream_id/streamId and result_id/resultId are
trusted caller-provided source identities; request_id is NOT a result ID.
stream_epoch is an optional caller-supplied reconnect discriminator.

Call begin_stream() before a known new stream, even if its provider ID is
unchanged/absent. Offset/identity changes and time regressions also partition
evidence, but identical identity-less callbacks cannot distinguish a replay
from a reconnect. They are deduplicated within the current epoch. Never use
START_OF_SPEECH/END_OF_SPEECH as reconnect notifications.

Matching is case/punctuation-normalized, exact and monotone, not fuzzy or
word-count based. Only spans common to every maximum-coverage alignment are
attributed. Supply the complete committed turn list each time; calls are
non-consuming. Ambiguity, cross-epoch turns, and resource limits fail closed.
Missing timestamps remain missing, including for multiword timed chunks.
"""

from __future__ import annotations

from array import array
from collections.abc import Mapping
from dataclasses import dataclass
import logging
import math
import re
from typing import Any, Literal, TypedDict
import unicodedata

logger = logging.getLogger("spashtai-agent.elevate_live_words")

VERSION = "elevate-live-words-v1"
MAX_EVENTS = 512
MAX_SOURCE_TOKENS = 8192
MAX_EVENT_WORDS = 2048
MAX_TEXT_CHARS = 32768
MAX_WORD_CHARS = 256
MAX_TURNS = 512
MAX_ALIGNMENT_CELLS = 1_000_000
MAX_ID_CHARS = 256
_TOKEN_RE = re.compile(r"[^\W_]+(?:'[^\W_]+)*", re.UNICODE)


class _RequiredWord(TypedDict):
    w: str
    start: float
    end: float


class SourceWord(_RequiredWord, total=False):
    recognitionConfidence: float


class _RequiredEvidence(TypedDict):
    version: Literal["elevate-live-words-v1"]
    provider: str
    state: Literal["source_only", "unavailable"]
    reason: str
    clock: Literal["stt_stream"]
    words: list[SourceWord]
    mapping: None


class LiveWordEvidence(_RequiredEvidence, total=False):
    streamId: str
    resultIds: list[str]


@dataclass(frozen=True)
class _Word:
    text: str
    start: float
    end: float
    confidence: float | None

    def as_dict(self) -> SourceWord:
        result: SourceWord = {"w": self.text, "start": self.start, "end": self.end}
        if self.confidence is not None:
            result["recognitionConfidence"] = self.confidence
        return result


@dataclass(frozen=True)
class _Parsed:
    tokens: tuple[str, ...]
    words: tuple[_Word | None, ...]
    reason: str | None
    start: float | None
    end: float | None
    offset: float | None


@dataclass(frozen=True)
class _Fragment:
    parsed: _Parsed
    epoch: int
    stream_id: str | None
    result_id: str | None


def _field(value: object, *names: str) -> Any:
    for name in names:
        if isinstance(value, Mapping):
            if name in value:
                return value[name]
        elif hasattr(value, name):
            return getattr(value, name)
    return None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def _identity(value: object) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > MAX_ID_CHARS:
        raise ValueError("invalid_source_identity")
    return str(value)


def _tokens(text: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKC", text).casefold().replace("\u2019", "'")
    return tuple(_TOKEN_RE.findall(normalized))


def _unique_word_positions(
    transcript: tuple[str, ...], words: list[str]
) -> list[int | None] | None:
    """Use earliest/latest complete embeddings to expose repeated-word ambiguity."""
    earliest: list[int] = []
    cursor = 0
    for word in words:
        while cursor < len(transcript) and transcript[cursor] != word:
            cursor += 1
        if cursor == len(transcript):
            return None
        earliest.append(cursor)
        cursor += 1
    latest: list[int] = []
    cursor = len(transcript) - 1
    for word in reversed(words):
        while cursor >= 0 and transcript[cursor] != word:
            cursor -= 1
        if cursor < 0:
            return None
        latest.append(cursor)
        cursor -= 1
    return [a if a == b else None for a, b in zip(earliest, reversed(latest))]


def _parse(data: object) -> _Parsed:
    text = _field(data, "text", "transcript")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("invalid_final_text")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError("evidence_limit_exceeded")
    tokens = _tokens(text)
    if not tokens:
        raise ValueError("invalid_final_text")
    if len(tokens) > MAX_EVENT_WORDS:
        raise ValueError("evidence_limit_exceeded")

    start = _number(_field(data, "start_time", "start"))
    end = _number(_field(data, "end_time", "end"))
    segment_valid = start is not None and end is not None and 0 <= start < end
    raw_words = _field(data, "words")
    if raw_words is None:
        raw_words = []
    if not isinstance(raw_words, (list, tuple)):
        raise ValueError("invalid_words")
    if len(raw_words) > MAX_EVENT_WORDS:
        raise ValueError("evidence_limit_exceeded")

    lexical: list[str] = []
    timed: list[_Word | None] = []
    offsets: set[float] = set()
    reason: str | None = None
    previous_end = -1.0
    for raw in raw_words:
        label = str(raw) if isinstance(raw, str) else _field(raw, "w", "word", "text")
        if not isinstance(label, str):
            reason = reason or "invalid_word_text"
            continue
        if len(label) > MAX_WORD_CHARS:
            raise ValueError("evidence_limit_exceeded")
        parts = _tokens(label)
        if not parts:
            continue  # Untimed punctuation is not a spoken word.
        if len(parts) != 1:
            reason = reason or "non_word_timing"
            continue
        lexical.append(parts[0])
        word_start = _number(_field(raw, "start_time", "start"))
        word_end = _number(_field(raw, "end_time", "end"))
        offset = _number(_field(raw, "start_time_offset"))
        if offset is not None:
            offsets.add(offset)
        if (
            word_start is None or word_end is None
            or not 0 <= word_start < word_end or word_start < previous_end
        ):
            reason = reason or "invalid_word_intervals"
            timed.append(None)
            continue
        if start is not None and end is not None and 0 <= start < end and (
            word_start < start or word_end > end
        ):
            reason = reason or "invalid_word_intervals"
            timed.append(None)
            continue
        previous_end = word_end
        confidence_raw = _field(raw, "recognitionConfidence", "confidence")
        confidence = _number(confidence_raw)
        if confidence is not None and not 0 <= confidence <= 1:
            confidence = None
        if isinstance(raw, str) and confidence == 0:
            confidence = None
        timed.append(_Word(label, word_start, word_end, confidence))

    positions = _unique_word_positions(tokens, lexical)
    mapped: list[_Word | None] = [None] * len(tokens)
    if positions is None:
        reason = "word_text_mismatch"
    elif len(offsets) > 1 or any(offset < 0 for offset in offsets):
        reason = "inconsistent_word_offsets"
    else:
        for position, word in zip(positions, timed):
            if position is None:
                reason = reason or "ambiguous_word_text"
            else:
                mapped[position] = word
    if not any(mapped):
        reason = reason or "word_timestamps_unavailable"
    elif not all(mapped):
        reason = reason or "incomplete_word_timestamps"
    return _Parsed(
        tokens, tuple(mapped), reason,
        start if segment_valid else None, end if segment_valid else None,
        next(iter(offsets)) if len(offsets) == 1 else None,
    )


def _align_turns(
    source: tuple[str, ...], queries: list[tuple[str, ...]]
) -> list[tuple[int, int] | str]:
    """Find spans mandatory in every maximum-token-coverage monotone alignment."""
    width = len(source) + 1
    if (len(queries) + 1) * width > MAX_ALIGNMENT_CELLS:
        return ["alignment_limit_exceeded"] * len(queries)
    by_token: dict[str, list[int]] = {}
    for index, token in enumerate(source):
        by_token.setdefault(token, []).append(index)
    candidates: list[list[tuple[int, int]]] = []
    comparisons = 0
    for query in queries:
        spans: list[tuple[int, int]] = []
        for start in by_token.get(query[0], []):
            comparisons += len(query)
            if comparisons > MAX_ALIGNMENT_CELLS:
                return ["alignment_limit_exceeded"] * len(queries)
            end = start + len(query)
            if source[start:end] == query:
                spans.append((start, end))
        candidates.append(spans)

    forward = [array("i", [0]) * width]
    for spans in candidates:
        previous = forward[-1]
        row = previous[:]
        for start, end in spans:
            row[end] = max(row[end], previous[start] + end - start)
        for position in range(1, width):
            row[position] = max(row[position], row[position - 1])
        forward.append(row)

    optimum = forward[-1][-1]
    backward = array("i", [0]) * width
    result: list[tuple[int, int] | str] = ["turn_text_not_matched"] * len(queries)
    for index in range(len(queries) - 1, -1, -1):
        spans = candidates[index]
        possible = [
            (start, end) for start, end in spans
            if forward[index][start] + end - start + backward[end] == optimum
        ]
        can_skip = any(
            left + right == optimum for left, right in zip(forward[index], backward)
        )
        if len(possible) == 1 and not can_skip:
            result[index] = possible[0]
        elif spans:
            result[index] = "ambiguous_turn_text"
        row = backward[:]
        for start, end in spans:
            row[start] = max(row[start], end - start + backward[end])
        for position in range(width - 2, -1, -1):
            row[position] = max(row[position], row[position + 1])
        backward = row
    return result


class LiveWordEvidenceCollector:
    """One collector per Elevate conversation; not thread-safe or clock-aligned."""

    def __init__(self, provider: str):
        if not isinstance(provider, str) or not provider.strip() or len(provider) > MAX_ID_CHARS:
            raise ValueError("provider must be a non-empty bounded string")
        self.provider = provider.strip()
        self._fragments: list[_Fragment] = []
        self._seen: set[
            tuple[str | None, str | int | None, float | None, str | None, _Parsed]
        ] = set()
        self._results: dict[tuple[int, str], _Parsed] = {}
        self._epoch = 0
        self._stream_id: str | None = None
        self._stream_epoch: str | int | None = None
        self._offset: float | None = None
        self._last_start: float | None = None
        self._token_count = 0
        self._failure: str | None = None

    def begin_stream(self, stream_id: str | None = None) -> None:
        """Partition a known reconnect; never synthesize a provider stream ID."""
        stream_id = _identity(stream_id)
        self._epoch += 1
        self._stream_id = stream_id
        self._stream_epoch = None
        self._offset = None
        self._last_start = None
        self._seen.clear()

    def ingest(self, event: object) -> bool:
        """Retain a new final; return False for duplicates, nonfinals or rejections."""
        kind = _field(event, "type")
        kind = getattr(kind, "value", kind)
        final = _field(event, "is_final")
        if _field(event, "is_partial") is True or final is False:
            return False
        if kind != "final_transcript" and not (
            kind in (None, "user_input_transcribed") and final is True
        ):
            return False
        if self._failure:
            return False
        try:
            alternatives = _field(event, "alternatives")
            if alternatives is not None:
                if not isinstance(alternatives, (list, tuple)) or not alternatives:
                    raise ValueError("invalid_final_alternatives")
                data = alternatives[0]
            else:
                data = event
            parsed = _parse(data)
            stream_id = _identity(_field(event, "stream_id", "streamId"))
            result_id = _identity(_field(event, "result_id", "resultId"))
            stream_epoch = _field(event, "stream_epoch")
            if stream_epoch is not None and (
                isinstance(stream_epoch, bool)
                or not isinstance(stream_epoch, (str, int))
                or len(str(stream_epoch)) > MAX_ID_CHARS
            ):
                raise ValueError("invalid_stream_epoch")
        except ValueError as error:
            self._fail(str(error))
            return False

        stream_id = stream_id if stream_id is not None else self._stream_id
        stream_epoch = stream_epoch if stream_epoch is not None else self._stream_epoch
        offset = parsed.offset if parsed.offset is not None else self._offset
        fingerprint = (stream_id, stream_epoch, offset, result_id, parsed)
        if fingerprint in self._seen:
            return False
        changed = (
            stream_id != self._stream_id or stream_epoch != self._stream_epoch
            or (self._offset is not None and offset != self._offset)
        )
        if changed:
            self._epoch += 1
            self._last_start = None
        self._stream_id = stream_id
        self._stream_epoch = stream_epoch
        self._offset = offset

        first_start = next((word.start for word in parsed.words if word), parsed.start)
        if first_start is not None and self._last_start is not None:
            if first_start < self._last_start:
                self._epoch += 1
        if result_id is not None:
            key = (self._epoch, result_id)
            if key in self._results:
                self._fail("conflicting_final_result")
                return False
        if len(self._fragments) >= MAX_EVENTS or (
            self._token_count + len(parsed.tokens) > MAX_SOURCE_TOKENS
        ):
            self._fail("evidence_limit_exceeded")
            return False
        self._last_start = first_start
        self._fragments.append(_Fragment(parsed, self._epoch, self._stream_id, result_id))
        self._seen.add(fingerprint)
        if result_id is not None:
            self._results[(self._epoch, result_id)] = parsed
        self._token_count += len(parsed.tokens)
        return True

    def _fail(self, reason: str) -> None:
        self._failure = reason
        logger.warning("Live word evidence unavailable: %s", reason)

    def _empty(self, reason: str) -> LiveWordEvidence:
        return {
            "version": VERSION, "provider": self.provider, "state": "unavailable",
            "reason": reason, "clock": "stt_stream", "words": [], "mapping": None,
        }

    def for_turns(self, turns: list[dict[str, Any]]) -> list[LiveWordEvidence]:
        """Return fresh metadata aligned to input turns; ignore all non-text clocks."""
        output: list[LiveWordEvidence] = []
        queries: list[tuple[str, ...]] = []
        indices: list[int] = []
        for index, turn in enumerate(turns):
            text = turn.get("text")
            if turn.get("role") != "user":
                output.append(self._empty("non_user_turn"))
            elif not isinstance(text, str) or not text.strip():
                output.append(self._empty("invalid_turn_text"))
            elif len(turns) > MAX_TURNS or len(text) > MAX_TEXT_CHARS:
                output.append(self._empty("alignment_limit_exceeded"))
            elif self._failure:
                output.append(self._empty(self._failure))
            elif not self._fragments:
                output.append(self._empty("no_final_stt_events"))
            else:
                tokens = _tokens(text)
                output.append(self._empty("turn_text_not_matched"))
                if tokens:
                    queries.append(tokens)
                    indices.append(index)
        if not queries:
            return output

        source = tuple(token for fragment in self._fragments for token in fragment.parsed.tokens)
        owners = [
            (fragment, word)
            for fragment in self._fragments for word in fragment.parsed.words
        ]
        for index, match in zip(indices, _align_turns(source, queries)):
            if isinstance(match, str):
                output[index] = self._empty(match)
                continue
            start, end = match
            selected = owners[start:end]
            if len({fragment.epoch for fragment, _ in selected}) != 1:
                output[index] = self._empty("stream_epoch_boundary")
                continue
            evidence = output[index]
            evidence["words"] = [word.as_dict() for _, word in selected if word is not None]
            issues = [fragment.parsed.reason for fragment, _ in selected if fragment.parsed.reason]
            evidence["reason"] = issues[0] if issues else "unanchored_stt_stream"
            if evidence["words"]:
                evidence["state"] = "source_only"
            else:
                evidence["reason"] = issues[0] if issues else "word_timestamps_unavailable"
            stream_ids = {fragment.stream_id for fragment, _ in selected}
            if len(stream_ids) == 1:
                stream_id = next(iter(stream_ids))
                if stream_id is not None:
                    evidence["streamId"] = stream_id
            result_ids = list(dict.fromkeys(
                fragment.result_id for fragment, _ in selected if fragment.result_id is not None
            ))
            if result_ids:
                evidence["resultIds"] = result_ids
        return output
