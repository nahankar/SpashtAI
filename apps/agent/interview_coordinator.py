"""Conversation coordinator for interview runs that pinned automatic progression.

The coordinator decides when an answer is complete (patient silence after
provider-final speech), then saves it through the same InterviewCapture barrier
and receipt as manual Finish, asks the server to finish and select the next bank
question, and reads that question. The server owns outcomes and question
identity; the coordinator never reads or speaks technical evaluations.
"""
import asyncio
import logging
import time
from typing import Awaitable, Callable
from uuid import uuid4

from interview_capture import CaptureUnavailable, InterviewCapture

logger = logging.getLogger("spashtai-agent.interview_coordinator")

# Server codes that end automatic progression for this practice (the learner can still end it).
STOP_CODES = {"PRACTICE_DURATION_REACHED", "PRACTICE_QUESTION_LIMIT", "QUESTION_BANK_EXHAUSTED"}
CLOSING_LINE = "That's the end of this practice. You can end it now to review your answers."


class ServerRefused(RuntimeError):
    def __init__(self, status: int, code: str | None):
        super().__init__(code or str(status))
        self.status, self.code = status, code


class InterviewCoordinator:
    """One lock serialises automatic handoff and learner controls for the open answer."""

    def __init__(self, *, capture: InterviewCapture, session, request: Callable[..., Awaitable[dict]],
                 voice_state: Callable[[], Awaitable[dict]], publish_state: Callable[[str, dict], Awaitable[None]],
                 run_id: str, policy: dict, attempt_has_speech: bool = False):
        self.capture = capture
        self.session = session
        self.request = request
        self.voice_state = voice_state
        self.publish_state = publish_state
        self.run_id = run_id
        self.handoff = policy["handoffSilenceMs"] / 1000
        self.lock = asyncio.Lock()
        self.state = "idle"
        self.timer = None
        self.hold = False
        self.has_speech = attempt_has_speech
        self.vad_speaking = False
        self.outcomes: dict[str, dict] = {}
        self.completed: dict[str, dict] = {}
        self.ask_task = None
        self.stopped = False
        self.suspended = False

    # ---- state -----------------------------------------------------------------------------
    async def _set(self, state: str, **extra):
        self.state = state
        try:
            await self.publish_state(state, {"attemptId": self.capture.state["attempt"]["id"], **extra})
        except Exception:
            logger.warning("Interview coordinator state could not be published")

    def _listening(self) -> bool:
        return self.state in {"listening", "candidate_end"} and self.capture.accepting and not self.stopped

    # ---- speech events (from the voice adapter) ---------------------------------------------
    def on_transcript(self, is_final: bool):
        if not self._listening():
            return
        if is_final:
            self.has_speech = True
            self._arm()
        else:
            self._cancel("listening")

    def on_vad(self, speaking: bool):
        self.vad_speaking = speaking
        if not self._listening():
            return
        if speaking:
            self._cancel("listening")
        else:
            self._arm()

    def _arm(self):
        """Start the handoff countdown only after real silence that follows provider-final speech."""
        if self.hold or self.vad_speaking or self.suspended:
            return
        if self.capture.unresolved_speech:
            # Voiced audio without any transcript is never saved or discarded automatically.
            asyncio.create_task(self._set("listening", reason="SPEECH_UNCONFIRMED"))
            return
        if not self.has_speech or self.capture.pending_interim or self.capture.pending_audio:
            return
        self._cancel(None)
        attempt_id = self.capture.state["attempt"]["id"]
        self.timer = asyncio.create_task(self._countdown(attempt_id))
        asyncio.create_task(self._set("candidate_end", handoffAt=str(int((time.time() + self.handoff) * 1000))))

    def _cancel(self, state: str | None):
        if self.timer is not None and not self.timer.done():
            self.timer.cancel()
        self.timer = None
        if state and self.state == "candidate_end":
            asyncio.create_task(self._set(state))

    async def _countdown(self, attempt_id: str):
        try:
            await asyncio.sleep(self.handoff)
        except asyncio.CancelledError:
            return
        # Conditions may have changed while the timer ran; any renewed speech already cancelled it.
        if not self._listening() or self.capture.state["attempt"]["id"] != attempt_id:
            return
        self.timer = None
        logger.info("interview_coordinator handoff=automatic handoff_ms=%d", round(self.handoff * 1000))
        try:
            await self.complete("FINISH", str(uuid4()), attempt_id, origin="automatic")
        except CaptureUnavailable as error:
            logger.info("interview_coordinator automatic_finish_deferred code=%s", error.code)
        except Exception:
            logger.warning("Interview coordinator automatic finish failed")

    # ---- learner controls --------------------------------------------------------------------
    def set_hold(self, hold: bool):
        self.hold = hold
        if hold:
            self._cancel("listening")
        else:
            self._arm()

    async def repeat(self) -> bool:
        """Re-read the open question; the answer so far is kept and the countdown restarts afterwards."""
        if not self._listening():
            return False
        self._cancel(None)
        await self._set("asking")
        try:
            return await self.capture.repeat_question(self.session)
        finally:
            await self._set("listening")
            self._arm()

    async def complete(self, action: str, request_id: str, attempt_id: str | None, *, origin: str = "manual",
                       accept_unresolved: bool = False) -> dict:
        """Save the answer (FINISH) or skip it, then finish it on the server and move to the next question."""
        async with self.lock:
            if request_id in self.outcomes:
                return self.outcomes[request_id]
            current = self.capture.state["attempt"]["id"]
            # A control aimed at an answer that has already completed (or at a question that has not been
            # loaded yet) returns that answer's outcome and never touches the next question.
            if current in self.completed:
                return {**self.completed[current], "duplicate": True}
            if attempt_id is not None and attempt_id != current:
                return {**self.completed.get(attempt_id, {}), "stale": True, "attemptId": attempt_id}
            self._cancel(None)
            started = time.monotonic()
            await self._set("confirming")
            try:
                receipt = await self.capture.drain(self.session, action, request_id, accept_unresolved=accept_unresolved)
            except CaptureUnavailable as error:
                if error.code == "TRANSCRIPT_PENDING" and self.capture.accepting:
                    # The learner is still speaking or a final is late: keep listening rather than cut them off.
                    self.session.input.set_audio_enabled(True)
                    await self._set("listening")
                raise
            drained = time.monotonic()
            await self._set("saving")
            try:
                await self.request(f"/attempts/{current}/finish", {"receiptId": receipt["receiptId"], "skip": action == "SKIP"})
            except ServerRefused as error:
                # The receipt is durable; a reconnect or a retried Finish completes it (unfinishedReceipt).
                await self._set("waiting", reason=error.code or "FINISH_FAILED")
                raise
            finished = time.monotonic()
            outcome = {**receipt, "completed": True, "origin": origin}
            self.completed[current] = outcome
            await self._advance(current)
            logger.info("interview_coordinator completed origin=%s action=%s drain_ms=%d finish_ms=%d next_ms=%d",
                        origin, action, round((drained - started) * 1000), round((finished - drained) * 1000),
                        round((time.monotonic() - finished) * 1000))
            self.outcomes[request_id] = outcome
            return outcome

    async def next_after(self, attempt_id: str) -> dict:
        """Manual Next (for example after a failed automatic advance); idempotent through afterAttemptId."""
        async with self.lock:
            return await self._advance(attempt_id)

    async def _advance(self, completed_attempt_id: str) -> dict:
        await self._set("preparing")
        try:
            attempt = await self.request(f"/runs/{self.run_id}/next", {"afterAttemptId": completed_attempt_id})
        except ServerRefused as error:
            if error.code in STOP_CODES:
                await self._set("waiting", reason=error.code)
                await self._say_closing()
                return {"advanced": False, "reason": error.code}
            await self._set("waiting", reason=error.code or "NEXT_FAILED")
            raise
        self._start_asking()
        return {"advanced": True, "attemptId": attempt["id"]}

    def _start_asking(self):
        async def ask():
            try:
                fresh = await self.voice_state()
                await self._set("asking", attemptId=fresh["attempt"]["id"])
                await self.capture.activate_question(self.session, fresh)
                self.has_speech = bool(fresh.get("attemptHasSpeech"))
                self.hold = False
                await self._set("listening")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Interview coordinator could not read the next question")
                await self._set("waiting", reason="QUESTION_UNAVAILABLE")
        self.ask_task = asyncio.create_task(ask())

    async def _say_closing(self):
        try:
            await self.session.say(CLOSING_LINE, allow_interruptions=True)
        except Exception:
            logger.warning("Interview coordinator closing line unavailable")

    async def resume_unfinished(self, receipt: dict, attempt_id: str):
        """A previous connection saved a completion receipt but the finish never reached the server."""
        async with self.lock:
            await self._set("saving")
            try:
                await self.request(f"/attempts/{attempt_id}/finish", {"receiptId": receipt["id"], "skip": receipt["action"] == "SKIP"})
            except ServerRefused as error:
                await self._set("waiting", reason=error.code or "FINISH_FAILED")
                raise
            self.completed[attempt_id] = {"receiptId": receipt["id"], "action": receipt["action"], "completed": True, "origin": "resume"}
            return await self._advance(attempt_id)

    async def question_ready(self, attempt_has_speech: bool):
        self.has_speech = attempt_has_speech
        self.hold = False
        await self._set("listening")
        if attempt_has_speech and not self.vad_speaking:
            self._arm()

    def suspend(self):
        """Pause or End requested: no automatic handoff while that save runs."""
        self.suspended = True
        self._cancel(None)

    def stop(self):
        self.stopped = True
        self._cancel(None)
        if self.ask_task is not None and not self.ask_task.done():
            self.ask_task.cancel()
