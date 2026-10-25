"""Interview-only committed speech queue and explicit save barrier.

Provider-final STT events are authoritative. SDK manual-commit output (which
may contain promoted interim text after timeout) is never used as answer text,
and the save barrier no longer waits on the SDK's commit at all: it watches the
raw provider events this module already receives.
"""
import asyncio
import json
import logging
from collections import deque
from typing import Awaitable, Callable
from uuid import UUID

logger = logging.getLogger("spashtai-agent.interview_capture")

# Save-barrier timing. Detaching input keeps feeding silence to the recognizer (interview_audio),
# so pending speech finalises on its own; the barrier only waits for that, never for a fixed timeout.
SETTLE_SECONDS = 1.2       # quiet time after detach/last speech event before speech is complete
MAX_BARRIER_SECONDS = 8.0  # bound before reporting TRANSCRIPT_PENDING (the previous fixed wait)
UNVOICED_SECONDS = 3.0     # VAD speech that never yields any transcript is treated as noise
POLL_SECONDS = 0.05


class CaptureUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class InterviewCapture:
    def __init__(self, state: dict, send: Callable[..., Awaitable[dict]], publish: Callable[..., Awaitable[None]],
                 *, settle: float = SETTLE_SECONDS, max_barrier: float = MAX_BARRIER_SECONDS,
                 unvoiced: float = UNVOICED_SECONDS, poll: float = POLL_SECONDS):
        self.state = state
        self.send = send
        self.publish = publish
        self.index = state["nextTurnIndex"]
        self.pending = deque()
        self.pending_interim = False
        self.pending_audio = False
        self.accepting = False
        self.worker = None
        self.error = None
        self.lock = asyncio.Lock()
        self.finished_requests = {}
        self.sealed = False
        self.settle, self.max_barrier, self.unvoiced, self.poll = settle, max_barrier, unvoiced, poll
        self.last_activity = 0.0
        self.speech_started_at = None
        self.transcript_since_speech = True
        self.last_final_at = None

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    def observe_provider_transcript(self, text: str, is_final: bool) -> None:
        if not self.accepting or not text or not text.strip():
            return
        self.last_activity = self._now()
        self.transcript_since_speech = True
        if not is_final:
            self.pending_interim = True
            return
        self.pending_interim = False
        self.pending_audio = False
        self.last_final_at = self.last_activity
        item = {"attemptId": self.state["attempt"]["id"], "body": {
            "segmentId": self.state["segmentId"], "sourceTurnId": f"user_turn_{self.index}",
            "localTurnIndex": self.index, "role": "user", "text": text,
        }}
        self.index += 1
        self.pending.append(item)
        self._start_worker()

    def observe_speech_start(self) -> None:
        if self.accepting:
            self.pending_audio = True
            self.speech_started_at = self.last_activity = self._now()
            self.transcript_since_speech = False

    def _start_worker(self):
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._flush())

    async def _flush(self):
        self.error = None
        while self.pending:
            item = self.pending[0]
            try:
                await self.send(f"/attempts/{item['attemptId']}/chunks", item["body"])
                await self.publish("user", item["body"]["text"],
                    f"answer_{item['attemptId']}::{item['body']['segmentId']}::{item['body']['sourceTurnId']}")
            except Exception:
                self.error = "SAVE_FAILED"
                return
            self.pending.popleft()

    async def _await_complete_speech(self, detached_at: float):
        """Return None once provider-final speech is complete, else the pending reason after the bound."""
        deadline = detached_at + self.max_barrier
        while True:
            now = self._now()
            # VAD speech that produced no transcript at all (a cough, a breath) cannot hold the answer forever.
            if (self.pending_audio and not self.pending_interim and not self.transcript_since_speech
                    and self.speech_started_at is not None and now - max(self.speech_started_at, detached_at) >= self.unvoiced):
                self.pending_audio = False
                logger.info("interview_drain unvoiced_speech_ignored")
            if not self.pending_interim and not self.pending_audio and now - max(self.last_activity, detached_at) >= self.settle:
                return None
            if now >= deadline:
                return "interim" if self.pending_interim else "speech"
            await asyncio.sleep(self.poll)

    async def drain(self, session, action: str, request_id: str) -> dict:
        if action not in {"FINISH", "SKIP", "PAUSE", "LEAVE"}:
            raise CaptureUnavailable("INVALID_ACTION")
        try:
            UUID(request_id)
        except (ValueError, TypeError, AttributeError):
            raise CaptureUnavailable("INVALID_REQUEST")
        async with self.lock:
            if request_id in self.finished_requests:
                previous = self.finished_requests[request_id]
                if previous["action"] != action:
                    raise CaptureUnavailable("REQUEST_CONFLICT")
                return previous
            if self.sealed:
                raise CaptureUnavailable("SEGMENT_SEALED")
            started = self._now()
            # Speech still in progress when the request arrives must reach a provider final first.
            if self.accepting and getattr(session, "user_state", None) == "speaking" and not self.pending_audio:
                self.pending_audio = True
                self.speech_started_at = started
                self.transcript_since_speech = False
            flags = (self.pending_interim, self.pending_audio)
            # Detaching makes the SDK end the user turn; the keepalive keeps flushing STT with silence.
            session.input.set_audio_enabled(False)
            # Skipped speech is never saved, so a skip does not wait for it.
            reason = None if action == "SKIP" else await self._await_complete_speech(started)
            barrier_ms = round((self._now() - started) * 1000)
            if reason:
                logger.info("interview_drain action=%s outcome=transcript_pending reason=%s barrier_ms=%d pending_interim=%s pending_audio=%s",
                            action, reason, barrier_ms, *flags)
                raise CaptureUnavailable("TRANSCRIPT_PENDING")
            # Later speech belongs to no answer: the receipt below must cover exactly the saved turns.
            self.accepting = False
            self._start_worker()
            await self.worker
            flushed = self._now()
            if self.error or self.pending:
                self.accepting = action != "SKIP"
                raise CaptureUnavailable("SAVE_FAILED")
            result = await self.send(f"/attempts/{self.state['attempt']['id']}/receipts", {
                "id": request_id, "segmentId": self.state["segmentId"], "action": action,
                "lastTurnIndex": self.index - 1,
            })
            done = self._now()
            if action in {"PAUSE", "LEAVE"}:
                self.sealed = True
            receipt = {"receiptId": result["id"], "action": action, "attemptId": self.state["attempt"]["id"],
                       "segmentId": self.state["segmentId"]}
            self.finished_requests[request_id] = receipt
            logger.info("interview_drain action=%s outcome=saved barrier_ms=%d flush_ms=%d receipt_ms=%d total_ms=%d pending_interim=%s pending_audio=%s",
                        action, barrier_ms, round((flushed - started) * 1000) - barrier_ms, round((done - flushed) * 1000),
                        round((done - started) * 1000), *flags)
            return receipt

    async def activate_question(self, session, state: dict):
        async with self.lock:
            if self.sealed:
                raise CaptureUnavailable("SEGMENT_SEALED")
            if self.accepting and self.state["attempt"]["id"] == state["attempt"]["id"]:
                return self.state["attempt"]
            session.input.set_audio_enabled(False)
            self.accepting = False
            self.state = state
            if state["attempt"]["status"] not in {"PREPARED", "ASKED"}:
                return state["attempt"]
            text = state["attempt"]["question"]["text"]
            await session.say(text, allow_interruptions=False)
            attempt = await self.send(f"/attempts/{state['attempt']['id']}/asked", {
                "segmentId": state["segmentId"], "questionText": text,
            })
            self.state["attempt"] = attempt
            await self.publish("assistant", text, f"question_{attempt['id']}")
            # Only a raw provider final can clear this flag after new speech.
            self.pending_interim = False
            self.pending_audio = False
            self.speech_started_at = None
            self.transcript_since_speech = True
            self.last_final_at = None
            self.accepting = True
            session.clear_user_turn()
            # An expired practice can resume its existing question. The server
            # fences new questions; keep this answer recordable until drained.
            session.input.set_audio_enabled(True)
            return attempt


def parse_control(payload: str) -> dict:
    try:
        value = json.loads(payload)
        if not isinstance(value, dict) or set(value) != {"action", "requestId"}:
            raise ValueError()
        if value["action"] not in {"FINISH", "SKIP", "PAUSE", "LEAVE", "NEXT"}:
            raise ValueError()
        UUID(value["requestId"])
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        raise CaptureUnavailable("INVALID_REQUEST")
