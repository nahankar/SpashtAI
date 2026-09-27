"""Bound turn requests without sacrificing committed transcript text."""

import json
import logging
from typing import Any

from elevate_live_words import VERSION

logger = logging.getLogger("spashtai-agent.elevate_turn_upload")
# Leave headroom beneath the API's default express.json() limit of 100 KiB.
MAX_UPLOAD_BYTES = 96 * 1024


def attach_stream_clocks(
    batches: list[dict[str, Any]], clocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach the full stream-clock snapshot only when the batch still fits."""
    if not batches or not clocks:
        return batches
    trial = {**batches[-1], "streamClocks": clocks}
    if len(json.dumps(trial).encode("utf-8")) > MAX_UPLOAD_BYTES:
        logger.warning("Stream clock omitted; recording alignment required")
        return batches
    updated = list(batches)
    updated[-1] = trial
    return updated


def build_turn_upload_batches(
    turns: list[dict[str, Any]], segment_id: str | None = None,
) -> list[dict[str, Any]]:
    def payload(items):
        body = {"turns": items}
        if segment_id:
            body["segmentId"] = segment_id
        return body

    def size(items):
        # aiohttp ClientSession's default JSON serializer uses these defaults.
        return len(json.dumps(payload(items)).encode("utf-8"))

    batches = []
    current = []
    for original in turns:
        turn = original
        if size([turn]) > MAX_UPLOAD_BYTES:
            metrics = turn.get("metrics")
            source = metrics.get("live_word_evidence") if isinstance(metrics, dict) else None
            if isinstance(source, dict):
                turn = {**turn, "metrics": {**metrics, "live_word_evidence": {
                    "version": VERSION, "provider": source.get("provider", "unknown"),
                    "state": "unavailable", "reason": "source_payload_limit",
                    "clock": "stt_stream", "words": [], "mapping": None,
                }}}
                logger.warning("Optional live word data omitted to fit the turn upload limit")
            if size([turn]) > MAX_UPLOAD_BYTES:
                raise ValueError("Committed turn exceeds upload limit even without source words")
        if current and size([*current, turn]) > MAX_UPLOAD_BYTES:
            batches.append(payload(current))
            current = []
        current.append(turn)
    if current:
        batches.append(payload(current))
    return batches
