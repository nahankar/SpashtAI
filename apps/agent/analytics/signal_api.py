"""
SpashtAI Signal Extraction API

Lightweight HTTP server that the Node.js backend calls to extract
communication signals from session transcripts using spaCy + textstat.

Runs alongside the LiveKit agent process.
"""

import json
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

from .text_signals import extract_text_signals

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

        self.send_response(404)
        self.end_headers()


def start_signal_api(blocking: bool = False):
    """Start the signal extraction HTTP server."""
    server = HTTPServer(("0.0.0.0", SIGNAL_API_PORT), SignalHandler)
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
