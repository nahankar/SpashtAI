"""
SpashtAI Signal Extraction API

Lightweight HTTP server that the Node.js backend calls to extract
communication signals from session transcripts using spaCy + textstat.

Runs alongside the LiveKit agent process.
"""

import json
import logging
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from .text_signals import extract_text_signals
from .prosody import analyze_prosody
from delivery_features import (
    AlignedWord,
    CaptureMetadata,
    DeliveryFeatureRequest,
    SegmentClock,
    TurnWindow,
    extract_delivery_feature_result,
)

logger = logging.getLogger("spashtai-signal-api")

SIGNAL_API_PORT = int(os.getenv("SIGNAL_API_PORT", "4001"))
INTERNAL_AGENT_TOKEN = os.getenv("INTERNAL_AGENT_TOKEN", "dev-internal-agent-token")


class SignalHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.debug(format, *args)

    def _check_auth(self) -> bool:
        token = self.headers.get("x-internal-agent-token", "")
        if token != INTERNAL_AGENT_TOKEN:
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return False
        return True

    def _read_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _json_response(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    @staticmethod
    def _delivery_feature_request(body: dict) -> DeliveryFeatureRequest:
        """Parse only server-authenticated, already-validated evidence input."""
        def text(value, name: str) -> str:
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} required")
            return value.strip()

        def number(value, name: str) -> float:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be finite")
            result = float(value)
            if not math.isfinite(result):
                raise ValueError(f"{name} must be finite")
            return result

        def timing_origin(value) -> str:
            origin = value.get("timingOrigin", value.get("timing_origin"))
            if origin not in {"actual", "forced_alignment", "synthetic", "unknown"}:
                raise ValueError("word timing origin is invalid")
            return origin

        def capture_metadata(raw) -> CaptureMetadata:
            if raw is None:
                return CaptureMetadata()
            if not isinstance(raw, dict):
                raise ValueError("capture must be an object")
            keys = (
                "automaticGainControl",
                "noiseSuppression",
                "echoCancellation",
                "voiceIsolation",
            )
            if any(raw.get(key) is not None and not isinstance(raw[key], bool) for key in keys):
                raise ValueError("capture settings must be boolean or null")
            return CaptureMetadata(
                automatic_gain_control=raw.get("automaticGainControl"),
                noise_suppression=raw.get("noiseSuppression"),
                echo_cancellation=raw.get("echoCancellation"),
                voice_isolation=raw.get("voiceIsolation"),
            )

        raw_segments = body.get("segments", [])
        raw_turns = body.get("turns", [])
        if not isinstance(raw_segments, list) or not isinstance(raw_turns, list):
            raise ValueError("segments and turns must be arrays")
        segments = tuple(
            SegmentClock(
                segment_id=text(item.get("segmentId"), "segmentId"),
                replay_offset_sec=number(item.get("replayOffsetSec"), "replayOffsetSec"),
                duration_sec=number(item.get("durationSec"), "durationSec"),
                audio_available=item.get("audioAvailable") is True,
                capture_metadata=capture_metadata(item.get("capture")),
            )
            for item in raw_segments
            if isinstance(item, dict)
        )
        if len(segments) != len(raw_segments):
            raise ValueError("segments must be objects")

        turns: list[TurnWindow] = []
        for raw_turn in raw_turns:
            if not isinstance(raw_turn, dict):
                raise ValueError("turns must be objects")
            turn_id = text(raw_turn.get("turnId"), "turnId")
            segment_id = raw_turn.get("segmentId")
            if segment_id is not None and not isinstance(segment_id, str):
                raise ValueError("segmentId must be a string")
            clock = "segment" if segment_id else "merged"
            raw_words = raw_turn.get("words")
            if not isinstance(raw_words, list):
                raise ValueError("turn words must be an array")
            words: list[AlignedWord] = []
            for raw_word in raw_words:
                if not isinstance(raw_word, dict):
                    raise ValueError("word must be an object")
                word = raw_word.get("w", raw_word.get("word"))
                words.append(
                    AlignedWord(
                        word=text(word, "word"),
                        start_sec=number(raw_word.get("start"), "word start"),
                        end_sec=number(raw_word.get("end"), "word end"),
                        turn_id=turn_id,
                        timing_origin=timing_origin(raw_word),  # type: ignore[arg-type]
                        segment_id=segment_id,
                        clock=clock,  # type: ignore[arg-type]
                    )
                )
            turns.append(
                TurnWindow(
                    turn_id=turn_id,
                    start_sec=number(raw_turn.get("audioStart"), "audioStart"),
                    end_sec=number(raw_turn.get("audioEnd"), "audioEnd"),
                    words=tuple(words),
                    alignment_coverage=number(raw_turn.get("alignmentCoverage"), "alignmentCoverage"),
                    segment_id=segment_id,
                    clock=clock,  # type: ignore[arg-type]
                )
            )

        return DeliveryFeatureRequest(
            audio_path=text(body.get("audioPath"), "audioPath"),
            audio_input_signature=text(body.get("audioInputSignature"), "audioInputSignature"),
            expected_audio_input_signature=text(
                body.get("expectedAudioInputSignature"), "expectedAudioInputSignature",
            ),
            analyzer_version=text(body.get("analyzerVersion"), "analyzerVersion"),
            turns=tuple(turns),
            segments=segments,
            complete_segment_audio=body.get("completeSegmentAudio") is True,
            capture_metadata=capture_metadata(body.get("capture")),
        )

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "service": "signal-api"})
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/extract-signals":
            if not self._check_auth():
                return
            body = self._read_body()
            if not body or "messages" not in body:
                self._json_response(400, {"error": "messages required"})
                return

            try:
                messages = body["messages"]
                duration_sec = body.get("durationSec", 0)
                session_id = body.get("sessionId", "unknown")

                logger.info(
                    "Extracting signals for session %s (%d messages, %.0fs)",
                    session_id, len(messages), duration_sec,
                )

                signals = extract_text_signals(messages, duration_sec)

                logger.info("Signal extraction complete for session %s", session_id)
                self._json_response(200, {
                    "sessionId": session_id,
                    "mode": "text_only",
                    "signals": signals,
                })
            except Exception as e:
                logger.error("Signal extraction failed: %s", e, exc_info=True)
                self._json_response(500, {"error": str(e)})
            return

        if self.path == "/analyze-prosody":
            if not self._check_auth():
                return
            body = self._read_body()
            audio_path = (body or {}).get("audioPath")
            session_id = (body or {}).get("sessionId", "unknown")
            if not audio_path:
                self._json_response(400, {"error": "audioPath required"})
                return
            try:
                logger.info("Analyzing prosody for session %s (%s)", session_id, audio_path)
                prosody = analyze_prosody(audio_path)
                if prosody is None:
                    self._json_response(200, {"sessionId": session_id, "prosody": None})
                    return
                self._json_response(200, {"sessionId": session_id, "prosody": prosody})
            except Exception as e:
                logger.error("Prosody analysis failed: %s", e, exc_info=True)
                self._json_response(500, {"error": str(e)})
            return

        if self.path == "/extract-delivery-features":
            if not self._check_auth():
                return
            try:
                body = self._read_body()
                if not isinstance(body, dict):
                    raise ValueError("JSON object required")
                request = self._delivery_feature_request(body)
                result = extract_delivery_feature_result(request)
                self._json_response(200, {
                    "state": result.state,
                    "reason": result.reason,
                    "observations": [item.to_dict() for item in result.observations],
                })
            except ValueError as error:
                self._json_response(400, {"error": str(error)})
            except Exception as error:  # noqa: BLE001
                logger.error("Delivery feature extraction failed: %s", error, exc_info=True)
                self._json_response(500, {"error": "delivery feature extraction failed"})
            return

        self.send_response(404)
        self.end_headers()


def start_signal_api(blocking: bool = False):
    """Start the signal extraction HTTP server.

    Threaded so a slow request (e.g. Praat/ffmpeg prosody) can't block a
    concurrent /extract-signals call and serialize the analytics pipeline.
    """
    server = ThreadingHTTPServer(("0.0.0.0", SIGNAL_API_PORT), SignalHandler)
    logger.info("Signal API listening on port %d", SIGNAL_API_PORT)

    if blocking:
        server.serve_forever()
    else:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    start_signal_api(blocking=True)
