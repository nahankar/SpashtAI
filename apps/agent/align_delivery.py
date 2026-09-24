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


def validate_result(raw, tokens, duration):
    """Require complete word coverage within each returned turn.

    Missing words suppress their whole turn. Preserve transcript punctuation
    for pause context, but never manufacture timestamps for missing words.
    """
    matched = {}
    previous_end = 0.0
    previous_index = -1
    for word in raw.get("words", []):
        if word.get("case") != "success":
            continue
        start, end = word.get("start"), word.get("end")
        if (type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or start < previous_end or end <= start or end > duration):
            raise ValueError("invalid_alignment_timestamps")
        a, b = word.get("startOffset"), word.get("endOffset")
        if type(a) is not int or type(b) is not int or b <= a:
            raise ValueError("missing_alignment_offsets")
        candidates = [i for i, (lo, hi, _, _) in enumerate(tokens)
                      if lo <= a < b <= hi]
        if len(candidates) != 1:
            raise ValueError("unaligned_transcript_token")
        index = candidates[0]
        if index <= previous_index or token(word.get("word", "")) != token(tokens[index][3]):
            raise ValueError("alignment_transcript_mismatch")
        matched[index] = {"w": tokens[index][3], "start": start, "end": end,
                          "timingOrigin": "forced_alignment"}
        previous_index, previous_end = index, end
    turns = {}
    for i, (_, _, turn_id, _) in enumerate(tokens):
        turns.setdefault(turn_id, []).append(i)
    return [{"id": turn_id, "words": [matched[i] for i in indexes]}
            for turn_id, indexes in turns.items() if all(i in matched for i in indexes)]


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
    except Exception as error:
        # Do not log transcript or service response bodies.
        print(f"Delivery alignment failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
