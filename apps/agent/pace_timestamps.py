from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

_WORD_RE = re.compile(r"[A-Za-z']+(?:[-'][A-Za-z']+)?")


@dataclass(frozen=True)
class TimestampEvidence:
    segment_start: float
    segment_end: float
    segment_valid: bool
    transcript_word_count: int
    timestamped_word_count: int
    invalid_timestamp_count: int
    out_of_order_timestamp_count: int

    @property
    def coverage(self) -> float:
        if self.transcript_word_count <= 0:
            return 0.0
        return self.timestamped_word_count / self.transcript_word_count

    @property
    def word_timestamps_valid(self) -> bool:
        return (
            self.segment_valid
            and self.coverage >= 0.95
            and self.invalid_timestamp_count == 0
            and self.out_of_order_timestamp_count == 0
        )

    @property
    def seconds(self) -> float | None:
        return self.segment_end - self.segment_start if self.segment_valid else None


def validate_timestamp_evidence(
    text: str,
    segment_start_raw: Any,
    segment_end_raw: Any,
    words: list[Any] | None,
) -> TimestampEvidence:
    transcript_word_count = len(_WORD_RE.findall(text or ""))
    try:
        segment_start = float(segment_start_raw)
        segment_end = float(segment_end_raw)
        segment_valid = (
            math.isfinite(segment_start)
            and math.isfinite(segment_end)
            and segment_start >= 0
            and segment_end > segment_start
        )
    except (TypeError, ValueError):
        segment_start = 0.0
        segment_end = 0.0
        segment_valid = False

    timestamped_word_count = 0
    invalid_timestamp_count = 0
    out_of_order_timestamp_count = 0
    previous_start = -1.0
    for word in words or []:
        try:
            word_start = float(getattr(word, "start_time", None))
            word_end = float(getattr(word, "end_time", None))
            valid = (
                segment_valid
                and math.isfinite(word_start)
                and math.isfinite(word_end)
                and word_start >= segment_start
                and word_end <= segment_end
                and word_end >= word_start
            )
        except (TypeError, ValueError):
            valid = False
            word_start = -1.0
        if not valid:
            invalid_timestamp_count += 1
            continue
        timestamped_word_count += 1
        if word_start < previous_start:
            out_of_order_timestamp_count += 1
        previous_start = max(previous_start, word_start)

    return TimestampEvidence(
        segment_start=segment_start,
        segment_end=segment_end,
        segment_valid=segment_valid,
        transcript_word_count=transcript_word_count,
        timestamped_word_count=timestamped_word_count,
        invalid_timestamp_count=invalid_timestamp_count,
        out_of_order_timestamp_count=out_of_order_timestamp_count,
    )
