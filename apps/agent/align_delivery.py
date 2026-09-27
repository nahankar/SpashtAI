"""Background alignment only: stdin request, stdout JSON; never writes metrics.

Align each complete user-audio segment separately. Gentle character offsets
bind words to committed turn IDs; interpolated Replay timings are never input.
"""
import asyncio
import json
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

import aiohttp

VERSION = "delivery-alignment-v1"
# Gentle often places the next word a few tens of milliseconds inside the
# previous word. That is a boundary touch, not a timeline that runs backwards.
BOUNDARY_SLACK_SEC = 0.05
# One or two unmatched words must not erase the words Gentle did place.
MAX_UNMATCHED_WORDS = 2
MIN_WORD_COVERAGE = 0.90
# Gentle answered, but its output failed validation. Retrying the same audio and
# transcript reproduces the result, so the caller must not treat this as an outage.
REJECTED_EXIT_CODE = 3
REJECTION_CODES = frozenset({
    "invalid_alignment_timestamps",
    "missing_alignment_offsets",
    "unaligned_transcript_token",
    "alignment_transcript_mismatch",
})


def token(value):
    return re.sub(r"[^\w']", "", value.lower(), flags=re.UNICODE)


def build_transcript(turns):
    text = ""
    tokens = []
    for turn in turns:
        if text:
            text += " "
        offset = len(text)
        text += turn["text"]
        for match in re.finditer(r"\S+", turn["text"]):
            if token(match.group()):
                tokens.append((offset + match.start(), offset + match.end(),
                               turn["id"], match.group()))
    return text, tokens


def _place_word(word, previous_end, duration):
    start, end = word.get("start"), word.get("end")
    if (type(start) not in (int, float) or type(end) not in (int, float)
            or not math.isfinite(start) or not math.isfinite(end)):
        raise ValueError("invalid_alignment_timestamps")
    if start < previous_end:
        if previous_end - start > BOUNDARY_SLACK_SEC or end <= previous_end:
            raise ValueError("invalid_alignment_timestamps")
        start = previous_end
    if end > duration:
        if end - duration > BOUNDARY_SLACK_SEC or end <= start:
            raise ValueError("invalid_alignment_timestamps")
        end = duration
    if end <= start:
        raise ValueError("invalid_alignment_timestamps")
    return start, end


def _token_index(word, tokens):
    a, b = word.get("startOffset"), word.get("endOffset")
    if type(a) is not int or type(b) is not int or b <= a:
        raise ValueError("missing_alignment_offsets")
    candidates = [i for i, (lo, hi, _, _) in enumerate(tokens) if lo <= a < b <= hi]
    if len(candidates) != 1:
        raise ValueError("unaligned_transcript_token")
    return candidates[0]


def _kept_turn(indexes, matched):
    """Keep a turn when every word is placed, or only a minor interior gap remains."""
    chosen = [index for index in indexes if index in matched]
    if not chosen:
        return None
    missing = len(indexes) - len(chosen)
    if missing == 0:
        return chosen
    if missing > MAX_UNMATCHED_WORDS or len(chosen) / len(indexes) < MIN_WORD_COVERAGE:
        return None
    # The first and last spoken words anchor the turn. A hole at either edge
    # would invent a span, so that turn stays with the other timing source.
    if chosen[0] != indexes[0] or chosen[-1] != indexes[-1]:
        return None
    return chosen


def validate_result(raw, tokens, duration):
    """Keep every successfully placed word.

    A turn with one or two interior misses stays, and those misses are omitted
    rather than given invented times. A hyphenated transcript word may come
    back as several aligned pieces. Larger gaps still drop only that turn.
    """
    matched = {}
    previous_end = 0.0
    previous_index = -1
    words = raw.get("words", [])
    i = 0
    while i < len(words):
        word = words[i]
        if word.get("case") != "success":
            i += 1
            continue
        raw_start, raw_end = word.get("start"), word.get("end")
        if (type(raw_start) in (int, float) and type(raw_end) in (int, float)
                and raw_end <= previous_end and raw_end - raw_start <= BOUNDARY_SLACK_SEC):
            # A few milliseconds sitting inside the previous word is not a timeline.
            i += 1
            continue
        start, end = _place_word(word, previous_end, duration)
        index = _token_index(word, tokens)
        if index <= previous_index:
            raise ValueError("alignment_transcript_mismatch")
        expected = token(tokens[index][3])
        parts = [token(word.get("word", ""))]
        if parts[0] != expected:
            # Gentle splits "industry-relevant" into the pieces on either side
            # of the hyphen. Keep one transcript word, from the first start to
            # the last end, only when those pieces rebuild the token.
            j = i + 1
            cursor = end
            while j < len(words) and words[j].get("case") == "success":
                if _token_index(words[j], tokens) != index:
                    break
                _, piece_end = _place_word(words[j], cursor, duration)
                parts.append(token(words[j].get("word", "")))
                cursor = piece_end
                j += 1
                if "".join(parts) == expected:
                    end = piece_end
                    i = j
                    break
            else:
                j = None
            if "".join(parts) != expected:
                raise ValueError("alignment_transcript_mismatch")
        else:
            i += 1
        matched[index] = {"w": tokens[index][3], "start": start, "end": end,
                          "timingOrigin": "forced_alignment"}
        previous_index, previous_end = index, end
        if parts[0] == expected:
            continue
        # i already points at the word after a joined split.
    turns = {}
    for i, (_, _, turn_id, _) in enumerate(tokens):
        turns.setdefault(turn_id, []).append(i)
    results = []
    for turn_id, indexes in turns.items():
        chosen = _kept_turn(indexes, matched)
        if not chosen:
            continue
        local = {index: position for position, index in enumerate(indexes)}
        words = []
        for index in chosen:
            word = dict(matched[index])
            word["tokenIndex"] = local[index]
            words.append(word)
        results.append({"id": turn_id, "words": words})
    return results


async def align(request):
    results = []
    url = os.getenv("GENTLE_URL", "http://localhost:8765").rstrip("/")
    with tempfile.TemporaryDirectory(prefix="delivery-alignment-") as directory:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=900)) as client:
            for n, segment in enumerate(request["segments"]):
                turns = [t for t in request["turns"] if t["segmentId"] == segment["segmentId"]]
                if not turns:
                    continue
                transcript, tokens = build_transcript(turns)
                if not tokens:
                    continue
                wav = str(Path(directory) / f"segment-{n}.wav")
                subprocess.run([
                    "ffmpeg", "-nostdin", "-v", "error", "-y",
                    "-i", request["audioPath"], "-ss", str(segment["replayOffsetSec"]),
                    "-t", str(segment["durationSec"]), "-ac", "1", "-ar", "16000", wav,
                ], check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                with open(wav, "rb") as audio:
                    form = aiohttp.FormData()
                    form.add_field("audio", audio, filename="segment.wav")
                    form.add_field("transcript", transcript)
                    async with client.post(f"{url}/transcriptions?async=false", data=form) as response:
                        response.raise_for_status()
                        raw = await response.json()
                results.extend(validate_result(raw, tokens, segment["durationSec"]))
    return {"version": VERSION, "turns": results}


if __name__ == "__main__":
    def stop(_signum, _frame):
        raise InterruptedError("alignment_cancelled")

    signal.signal(signal.SIGTERM, stop)
    try:
        print(json.dumps(asyncio.run(asyncio.wait_for(align(json.load(sys.stdin)), timeout=850))))
    except ValueError as error:
        if error.args and error.args[0] in REJECTION_CODES:
            print(f"Delivery alignment rejected: {error.args[0]}", file=sys.stderr)
            sys.exit(REJECTED_EXIT_CODE)
        print(f"Delivery alignment failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Do not log transcript or service response bodies.
        print(f"Delivery alignment failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
