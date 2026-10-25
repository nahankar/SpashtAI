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

# Save barrier. The answer boundary is the detach: the browser mutes the microphone and the agent
# stops passing room audio to the recognizer when a save is requested. Audio sent before that point
# keeps being recognised (interview_audio feeds silence so it finalises), and its provider finals are
# still accepted until the barrier confirms nothing is pending. Quiet alone never confirms completion:
# an unfinalised interim, or voiced speech with no transcript after it, keeps the save pending.
SETTLE_SECONDS = 1.2       # quiet after the detach and after the last speech event
MAX_BARRIER_SECONDS = 8.0  # bound before reporting the recoverable TRANSCRIPT_PENDING
UNRESOLVED_WAIT_SECONDS = 2.4  # when the learner chooses to save only confirmed speech
VAD_TAIL_SECONDS = 0.8     # Silero keeps reporting speech this long after the last voiced frame
POLL_SECONDS = 0.05


class CaptureUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class InterviewCapture:
    def __init__(self, state: dict, send: Callable[..., Awaitable[dict]], publish: Callable[..., Awaitable[None]],
                 *, settle: float = SETTLE_SECONDS, max_barrier: float = MAX_BARRIER_SECONDS,
                 unresolved_wait: float = UNRESOLVED_WAIT_SECONDS, vad_tail: float = VAD_TAIL_SECONDS, poll: float = POLL_SECONDS):
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
        self.settle, self.max_barrier, self.unresolved_wait, self.vad_tail, self.poll = settle, max_barrier, unresolved_wait, vad_tail, poll
        self.last_activity = 0.0
        self.last_final_at = None
        self.speech_active = False
        self.transcript_since_speech = True
        self.speaking = None

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    def observe_provider_transcript(self, text: str, is_final: bool) -> None:
        if not self.accepting:
            return
        words = bool(text and text.strip())
        if not is_final:
            if words:
                self.last_activity = self._now()
                self.transcript_since_speech = True
                self.pending_interim = True
            return
        # A provider final (even an empty one) is the recognizer's own statement that the pending
        # segment is complete; only one with words becomes part of the answer.
        self.last_activity = self.last_final_at = self._now()
        self.transcript_since_speech = True
        self.pending_interim = False
        self.pending_audio = False
        if not words:
            return
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
            self.speech_active = True
            self.last_activity = self._now()
            self.transcript_since_speech = False

    def observe_speech_end(self) -> None:
        if self.accepting:
            self.speech_active = False
            self.last_activity = self._now()

    @property
    def unresolved_speech(self) -> bool:
        """Voiced audio with no transcript event at all since it started (possibly noise, possibly words)."""
        return self.pending_audio and not self.transcript_since_speech

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

    async def _await_complete_speech(self, detached_at: float, bound: float):
        """Return None once provider-final speech is complete, else the pending reason after the bound."""
        deadline = detached_at + bound
        while True:
            now = self._now()
            if not self.pending_interim and not self.pending_audio and now - max(self.last_activity, detached_at) >= self.settle:
                return None
            if now >= deadline:
                return "interim" if self.pending_interim else "speech"
            await asyncio.sleep(self.poll)

    async def drain(self, session, action: str, request_id: str, *, accept_unresolved: bool = False) -> dict:
        """Save everything finalised before the boundary and record a receipt for exactly those turns.

        accept_unresolved is the learner's explicit choice, after TRANSCRIPT_PENDING, to save only the
        confirmed speech. Nothing is ever discarded automatically.
        """
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
            # Voiced audio at the request must produce a provider final after the boundary when it cannot
            # be covered by an earlier final: no transcript since it started, or voice reported for longer
            # than VAD's tail after the last final. Within the tail, "speaking" is usually VAD's own trailing
            # silence, so a pending interim and the settle window decide instead.
            speaking_now = self.speech_active or getattr(session, "user_state", None) == "speaking"
            beyond_tail = self.last_final_at is None or started - self.last_final_at > self.vad_tail
            if self.accepting and speaking_now and (not self.transcript_since_speech or beyond_tail):
                self.pending_audio = True
                self.transcript_since_speech = False
            flags = (self.pending_interim, self.pending_audio)
            # The boundary: no new room audio reaches the recognizer after this point.
            session.input.set_audio_enabled(False)
            reason = None
            if action == "SKIP":
                # Skipped speech is never saved; stop accepting now so none of it can reach a later answer.
                self.accepting = False
            else:
                reason = await self._await_complete_speech(started, self.unresolved_wait if accept_unresolved else self.max_barrier)
            barrier_ms = round((self._now() - started) * 1000)
            if reason and not accept_unresolved:
                logger.info("interview_drain action=%s outcome=transcript_pending reason=%s barrier_ms=%d pending_interim=%s pending_audio=%s",
                            action, reason, barrier_ms, *flags)
                raise CaptureUnavailable("TRANSCRIPT_PENDING")
            if reason:
                logger.info("interview_drain action=%s outcome=saved_confirmed_only reason=%s barrier_ms=%d", action, reason, barrier_ms)
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
            await self._speak(session, text)
            attempt = await self.send(f"/attempts/{state['attempt']['id']}/asked", {
                "segmentId": state["segmentId"], "questionText": text,
            })
            self.state["attempt"] = attempt
            await self.publish("assistant", text, f"question_{attempt['id']}")
            # Only a raw provider final can clear this flag after new speech.
            self.pending_interim = False
            self.pending_audio = False
            self.speech_active = False
            self.transcript_since_speech = True
            self.last_final_at = None
            # Resetting the user turn restarts the recognizer stream, so late results for audio from the
            # previous (finished or skipped) answer can never arrive once this answer accepts speech.
            session.clear_user_turn()
            self.accepting = True
            # An expired practice can resume its existing question. The server
            # fences new questions; keep this answer recordable until drained.
            session.input.set_audio_enabled(True)
            return attempt

    async def _speak(self, session, text: str):
        # Keep the handle so Pause, End or a disconnect can stop a long question mid-sentence.
        self.speaking = session.say(text, allow_interruptions=False)
        try:
            await self.speaking
        finally:
            self.speaking = None

    def interrupt_speech(self) -> None:
        handle = getattr(self, "speaking", None)
        if handle is not None and hasattr(handle, "interrupt"):
            handle.interrupt(force=True)

    async def repeat_question(self, session) -> bool:
        """Re-read the open question without creating an attempt; the learner's saved speech is kept."""
        async with self.lock:
            if not self.accepting or self.sealed:
                return False
            session.input.set_audio_enabled(False)
            try:
                await self._speak(session, self.state["attempt"]["question"]["text"])
            finally:
                session.input.set_audio_enabled(True)
            return True


CONTROL_ACTIONS = {"FINISH", "SKIP", "PAUSE", "LEAVE", "NEXT", "REPEAT", "HOLD", "RESUME_AUTO"}


def parse_control(payload: str) -> dict:
    try:
        value = json.loads(payload)
        # attemptId names the answer a conversation control targets; acceptUnresolved is the learner's
        # explicit choice (FINISH only) to save just the confirmed speech after TRANSCRIPT_PENDING.
        if not isinstance(value, dict) or not {"action", "requestId"} <= set(value) <= {"action", "requestId", "attemptId", "acceptUnresolved"}:
            raise ValueError()
        if value["action"] not in CONTROL_ACTIONS:
            raise ValueError()
        if "attemptId" in value and (not isinstance(value["attemptId"], str) or not 0 < len(value["attemptId"]) <= 160):
            raise ValueError()
        if "acceptUnresolved" in value and (value["acceptUnresolved"] is not True or value["action"] != "FINISH"):
            raise ValueError()
        UUID(value["requestId"])
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        raise CaptureUnavailable("INVALID_REQUEST")
