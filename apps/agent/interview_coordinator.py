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
# The learner's access to automatic conversation was withdrawn: continue with manual controls.
WITHDRAWN = "CONVERSATION_UNAVAILABLE"
CLOSING_LINE = "That's the end of this practice. You can end it now to review your answers."
# Bounded wait for an isolated short sound that never produced any transcript (a breath, click or cough
# detected as voice). Only when the answer already has confirmed words, the untranscribed sound totals at most
# VAD_ONLY_MAX_SECONDS, no partial text is pending, and recognition is not recovering or reporting a gap. After
# VAD_ONLY_GRACE_SECONDS of quiet the normal handoff countdown starts. This cannot always tell a short word
# from noise: a word the recognizer never transcribes is left out of the saved answer (the recording keeps it).
VAD_ONLY_MAX_SECONDS = 1.5
VAD_ONLY_GRACE_SECONDS = 3.0


class ServerRefused(RuntimeError):
    def __init__(self, status: int, code: str | None):
        super().__init__(code or str(status))
        self.status, self.code = status, code


def _code(error: Exception, default: str) -> str:
    return getattr(error, "code", None) or default


class InterviewCoordinator:
    """One lock serialises automatic handoff and learner controls for the open answer."""

    def __init__(self, *, capture: InterviewCapture, session, request: Callable[..., Awaitable[dict]],
                 voice_state: Callable[[], Awaitable[dict]], publish_state: Callable[[str, dict], Awaitable[None]],
                 run_id: str, policy: dict, attempt_has_speech: bool = False,
                 vad_only_grace: float = VAD_ONLY_GRACE_SECONDS, vad_only_max: float = VAD_ONLY_MAX_SECONDS):
        self.capture = capture
        self.session = session
        self.request = request
        self.voice_state = voice_state
        self.publish_state = publish_state
        self.run_id = run_id
        self.handoff = policy["handoffSilenceMs"] / 1000
        self.lock = asyncio.Lock()
        self.state = "idle"
        self.extra: dict = {}
        self.timer = None
        self.hold = False
        self.has_speech = attempt_has_speech
        self.vad_speaking = False
        self.outcomes: dict[str, dict] = {}
        self.completed: dict[str, dict] = {}
        # What stopped automatic progression, so Continue (or a reconnect) can resume exactly that step.
        self.failure: dict | None = None
        self.ask_task = None
        self.active = True
        self.stopped = False
        self.suspended = False
        self.vad_only_grace, self.vad_only_max = vad_only_grace, vad_only_max
        self.grace = None            # pending bounded wait for an untranscribed short sound
        self.vad_only = False        # that wait elapsed: the next handoff may ignore the sound
        self.recovering = False      # the recognizer was restarted and has not produced a result since
        self.gap = False             # untranscribed speech was reported for this answer

    # ---- state -----------------------------------------------------------------------------
    async def _set(self, state: str, **extra):
        self.state, self.extra = state, extra
        try:
            await self.publish_state(state, {"attemptId": self.capture.state["attempt"]["id"], "hold": self.hold, **extra})
        except Exception:
            logger.warning("Interview coordinator state could not be published")

    async def _republish(self):
        await self._set(self.state, **self.extra)

    def _listening(self) -> bool:
        return (self.active and not self.stopped and self.state in {"listening", "candidate_end"}
                and self.capture.accepting)

    # ---- speech events (from the voice adapter) ---------------------------------------------
    def on_transcript(self, is_final: bool, has_words: bool = True):
        if has_words or is_final:
            self.recovering = False  # recognizer progress
        if not self._listening():
            return
        if is_final:
            # Only words make an answer; an empty final may still have resolved pending speech.
            if has_words:
                self.has_speech = True
            self._arm()
        elif has_words:
            self._cancel("listening")

    def on_vad(self, speaking: bool):
        self.vad_speaking = speaking
        if not self._listening():
            return
        if speaking:
            self._cancel("listening")
        else:
            self._arm()

    def recognition_event(self, kind: str, detail: dict | None = None):
        """Recognizer supervision reports: a restart or gap disables the short-sound shortcut for the answer."""
        if kind in {"restarted", "unavailable"}:
            self.recovering = True
            if (detail or {}).get("lostSeconds"):
                self.gap = True
            self._cancel_grace()
        elif kind == "recovered":
            self.recovering = False

    def _vad_only_eligible(self) -> bool:
        c = self.capture
        return (self.has_speech and not c.pending_interim and not self.recovering and not self.gap
                and 0.0 < c.unresolved_voiced <= self.vad_only_max and not self.vad_speaking)

    def _cancel_grace(self):
        if self.grace is not None and not self.grace.done():
            self.grace.cancel()
        self.grace = None
        self.vad_only = False

    async def _grace_elapsed(self, attempt_id: str):
        try:
            await asyncio.sleep(self.vad_only_grace)
        except asyncio.CancelledError:
            return
        self.grace = None
        if (self._listening() and not self.hold and not self.suspended and self.capture.state["attempt"]["id"] == attempt_id
                and self.capture.unresolved_speech and self._vad_only_eligible()):
            logger.info("interview_coordinator untranscribed_sound_ignored voiced_ms=%d grace_ms=%d",
                        round(self.capture.unresolved_voiced * 1000), round(self.vad_only_grace * 1000))
            self.vad_only = True
            self._arm()

    def _arm(self):
        """Start the handoff countdown only after real silence that follows provider-final speech."""
        if not self._listening() or self.hold or self.vad_speaking or self.suspended:
            return
        vad_only = False
        if self.capture.unresolved_speech:
            if self._vad_only_eligible() and self.vad_only:
                vad_only = True  # bounded wait elapsed for a short sound with no transcript at all
            else:
                if self._vad_only_eligible() and self.grace is None:
                    self.grace = asyncio.create_task(self._grace_elapsed(self.capture.state["attempt"]["id"]))
                # Otherwise voiced audio without any transcript is never saved or discarded automatically.
                asyncio.create_task(self._set("listening", reason="SPEECH_UNCONFIRMED"))
                return
        if not self.has_speech or self.capture.pending_interim or (self.capture.pending_audio and not vad_only):
            return
        self._cancel(None)
        self.vad_only = vad_only
        attempt_id = self.capture.state["attempt"]["id"]
        self.timer = asyncio.create_task(self._countdown(attempt_id))
        asyncio.create_task(self._set("candidate_end", handoffAt=str(int((time.time() + self.handoff) * 1000))))

    def _cancel(self, state: str | None):
        if self.timer is not None and not self.timer.done():
            self.timer.cancel()
        self.timer = None
        if state is not None:
            # Renewed speech, recognizer progress or More time: any bounded wait starts again later.
            self._cancel_grace()
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
            await self.complete("FINISH", str(uuid4()), attempt_id, origin="automatic", accept_vad_only=self.vad_only)
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
        asyncio.create_task(self._republish())

    async def repeat(self) -> bool:
        """Re-read the open question; the answer so far is kept and the countdown restarts afterwards."""
        if not self._listening() or self.lock.locked():
            return False
        self._cancel(None)
        await self._set("asking")
        try:
            return await self.capture.repeat_question(self.session)
        finally:
            # Finish, Skip, Pause or End may have taken over while the question was read.
            if self.state == "asking" and not self.lock.locked() and not self.suspended and self.capture.accepting:
                await self._set("listening")
                self._arm()

    async def complete(self, action: str, request_id: str, attempt_id: str | None, *, origin: str = "manual",
                       accept_unresolved: bool = False, accept_vad_only: bool = False) -> dict:
        """Save the answer (FINISH) or skip it, then finish it on the server and move to the next question."""
        async with self.lock:
            return await self._complete(action, request_id, attempt_id, origin=origin, accept_unresolved=accept_unresolved,
                                        accept_vad_only=accept_vad_only)

    async def _complete(self, action: str, request_id: str, attempt_id: str | None, *, origin: str,
                        accept_unresolved: bool = False, accept_vad_only: bool = False) -> dict:
        if request_id in self.outcomes:
            return self.outcomes[request_id]
        current = self.capture.state["attempt"]["id"]
        # A control aimed at an answer that has already completed (or at a question that has not been
        # loaded yet) returns that answer's outcome and never touches the next question.
        if current in self.completed:
            return {**self.completed[current], "duplicate": True}
        if attempt_id is not None and attempt_id != current:
            return {**self.completed.get(attempt_id, {}), "stale": True, "attemptId": attempt_id}
        if self.failure and self.failure.get("attemptId") == current and self.failure["stage"] == "finish":
            # Already saved: finish it on the server instead of draining again.
            return await self._retry_failure()
        self._cancel(None)
        started = time.monotonic()
        await self._set("confirming")
        try:
            receipt = await self.capture.drain(self.session, action, request_id, accept_unresolved=accept_unresolved,
                                               accept_vad_only=accept_vad_only and action == "FINISH")
        except Exception as error:
            code = _code(error, "SAVE_FAILED")
            if self.capture.accepting and not self.stopped and not self.suspended:
                # The answer is still open (late or unconfirmed speech, nothing said yet, or an upload to
                # retry): keep listening rather than cut the learner off.
                if not self.capture.attached:
                    self.capture.enable_input(self.session)
                await self._set("listening", reason=code)
            else:
                self.failure = {"stage": "drain", "attemptId": current, "action": action, "requestId": request_id}
                await self._set("waiting", reason=code)
            raise
        drained = time.monotonic()
        self.has_speech = False
        self._cancel_grace(); self.gap = self.recovering = False
        await self._set("saving")
        try:
            await self.request(f"/attempts/{current}/finish", {"receiptId": receipt["receiptId"], "skip": action == "SKIP"})
        except Exception as error:
            # The receipt is durable: Continue or a reconnect finishes it without draining again.
            self.failure = {"stage": "finish", "attemptId": current, "receiptId": receipt["receiptId"], "action": action}
            await self._stopped(_code(error, "FINISH_FAILED"))
            raise
        finished = time.monotonic()
        self.failure = None
        outcome = {**receipt, "completed": True, "origin": origin}
        self.completed[current] = outcome
        self.outcomes[request_id] = outcome
        await self._advance(current)
        logger.info("interview_coordinator completed origin=%s action=%s drain_ms=%d finish_ms=%d next_ms=%d",
                    origin, action, round((drained - started) * 1000), round((finished - drained) * 1000),
                    round((time.monotonic() - finished) * 1000))
        return outcome

    async def _stopped(self, code: str):
        """Automatic progression stopped at a step the learner can retry (Continue) or leave by ending."""
        if code == WITHDRAWN:
            # Access was withdrawn: hand the saved receipt to the browser, which finishes it manually.
            self.active = False
            self.stop()
            failure = self.failure or {}
            await self._set("waiting", reason=code, receiptId=failure.get("receiptId", ""),
                            receiptAction=failure.get("action", "") if failure.get("stage") == "finish" else "")
            return
        await self._set("waiting", reason=code)

    async def next_after(self, attempt_id: str) -> dict:
        """Continue after a stop: retry what failed, or move on from a completed answer (idempotent)."""
        async with self.lock:
            if self.failure:
                return await self._retry_failure()
            if self.ask_task is not None and not self.ask_task.done():
                return {"asking": True}
            current = self.capture.state["attempt"]
            if current["id"] in self.completed or current["status"] in {"ANSWERED", "SKIPPED"}:
                return await self._advance(current["id"])
            return {"advanced": False, "attemptId": current["id"]}

    async def _retry_failure(self) -> dict:
        failure, self.failure = self.failure, None
        if failure["stage"] == "drain":
            return await self._complete(failure["action"], failure["requestId"], failure["attemptId"], origin="retry")
        if failure["stage"] == "ask":
            self._start_asking()
            return {"asking": True}
        if failure["stage"] == "finish":
            await self._set("saving")
            try:
                await self.request(f"/attempts/{failure['attemptId']}/finish",
                                   {"receiptId": failure["receiptId"], "skip": failure["action"] == "SKIP"})
            except Exception as error:
                self.failure = failure
                await self._stopped(_code(error, "FINISH_FAILED"))
                raise
            self.completed[failure["attemptId"]] = {"receiptId": failure["receiptId"], "action": failure["action"],
                                                    "completed": True, "origin": "retry"}
        return await self._advance(failure["attemptId"])

    async def _advance(self, completed_attempt_id: str) -> dict:
        if self.suspended or self.stopped:
            # Pause or End arrived during this save: the next question is prepared on resume, never now.
            return {"advanced": False, "reason": "STOPPED"}
        await self._set("preparing")
        try:
            attempt = await self.request(f"/runs/{self.run_id}/next", {"afterAttemptId": completed_attempt_id})
        except Exception as error:
            code = _code(error, "NEXT_FAILED")
            if code in STOP_CODES:
                await self._set("waiting", reason=code)
                await self._say_closing()
                return {"advanced": False, "reason": code}
            # The answer itself is complete; only the move to the next question is retried.
            self.failure = {"stage": "next", "attemptId": completed_attempt_id}
            await self._stopped(code)
            return {"advanced": False, "reason": code}
        self._start_asking()
        return {"advanced": True, "attemptId": attempt["id"]}

    def _start_asking(self):
        async def ask():
            try:
                fresh = await self.voice_state()
                if self.suspended or self.stopped:
                    return
                await self._set("asking", attemptId=fresh["attempt"]["id"])
                await self.capture.activate_question(self.session, fresh)
                self.has_speech = bool(fresh.get("attemptHasSpeech"))
                self.hold = False
                if self.capture.accepting and not self.suspended and not self.stopped:
                    await self._set("listening")
            except asyncio.CancelledError:
                raise
            except Exception:
                if self.suspended or self.stopped:
                    return
                logger.warning("Interview coordinator could not read the next question")
                self.failure = {"stage": "ask"}
                await self._set("waiting", reason="QUESTION_UNAVAILABLE")
        self.ask_task = asyncio.create_task(ask())

    async def _say_closing(self):
        try:
            await self.session.say(CLOSING_LINE, allow_interruptions=True)
        except Exception:
            logger.warning("Interview coordinator closing line unavailable")

    # ---- connection lifecycle ----------------------------------------------------------------
    async def begin(self, state: dict, unfinished_receipt: dict | None = None):
        """Start or resume on a new connection: finish a saved answer, continue after a completed one,
        or read the open question."""
        attempt = state["attempt"]
        if unfinished_receipt:
            await self.resume_unfinished(unfinished_receipt, attempt["id"])
        elif attempt["status"] in {"ANSWERED", "SKIPPED"}:
            await self.next_after(attempt["id"])
        else:
            await self._set("asking")
            await self.capture.activate_question(self.session, state)
            await self.question_ready(bool(state.get("attemptHasSpeech")))

    async def resume_unfinished(self, receipt: dict, attempt_id: str):
        """A previous connection saved a completion receipt but the finish never reached the server."""
        async with self.lock:
            self.failure = {"stage": "finish", "attemptId": attempt_id, "receiptId": receipt["id"], "action": receipt["action"]}
            return await self._retry_failure()

    async def question_ready(self, attempt_has_speech: bool):
        self.has_speech = attempt_has_speech
        self.hold = False
        self._cancel_grace(); self.gap = self.recovering = False
        if not self.capture.accepting:
            return  # the question was interrupted (Pause or End): there is nothing to listen for
        await self._set("listening")
        if attempt_has_speech and not self.vad_speaking:
            self._arm()

    def suspend(self):
        """Pause or End requested: no automatic handoff or advance while that save runs."""
        self.suspended = True
        self._cancel(None)
        self._cancel_grace()

    def stop(self):
        self.stopped = True
        self._cancel(None)
        self._cancel_grace()
        if self.ask_task is not None and not self.ask_task.done():
            self.ask_task.cancel()
