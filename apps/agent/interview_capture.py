"""Interview-only committed speech queue and explicit save barrier.

Provider-final STT events are authoritative. SDK manual-commit output (which
may contain promoted interim text after timeout) is never used as answer text,
and the save barrier no longer waits on the SDK's commit at all: it watches the
raw provider events this module already receives.
"""
import asyncio
import json
import logging
import time
from collections import deque
from typing import Awaitable, Callable
from uuid import UUID

logger = logging.getLogger("spashtai-agent.interview_capture")

# Save barrier. The answer boundary is the detach: the browser mutes the microphone and the agent
# stops passing room audio to the recognizer shortly after a save is requested. Audio sent before that
# point keeps being recognised (interview_audio feeds silence so it finalises), and its provider finals
# are still accepted until the barrier confirms nothing is pending. Quiet alone never confirms
# completion: an unfinalised interim, or voiced speech that no provider final covers, keeps it pending.
SETTLE_SECONDS = 1.2       # quiet after the detach and after the last speech event
MAX_BARRIER_SECONDS = 8.0  # bound before reporting the recoverable TRANSCRIPT_PENDING
UNRESOLVED_WAIT_SECONDS = 2.4  # when the learner chooses to save only confirmed speech
VAD_TAIL_SECONDS = 0.8     # Silero keeps reporting speech this long after the last voiced frame
BOUNDARY_GRACE_SECONDS = 0.25  # audio captured before the click may still be in transit to the agent
# Speech is ordered by audio time, not arrival time: a provider final covers voiced audio only when its
# last word ends at or after that speech started. Voice activity ends a segment only after 0.8 s of
# silence, so an earlier segment's words end well before the next start; the margin absorbs clock error.
COVERAGE_MARGIN_SECONDS = 0.4
SEGMENT_TOLERANCE_SECONDS = 0.05  # interims and the final of one recognizer segment share its start
POLL_SECONDS = 0.05


def reset_voice_activity(session) -> None:
    """Restart the session's voice-activity stream so speech right after input re-opens is reported.

    Detaching input stops audio to VAD mid-state; without a restart, speech that starts within VAD's
    tail of re-attaching produces no speech-start event. livekit-agents 1.5.8 exposes no public reset.
    """
    recognition = getattr(getattr(session, "_activity", None), "_audio_recognition", None)
    vad = getattr(session, "vad", None)
    update = getattr(recognition, "update_vad", None)
    if vad is not None and callable(update):
        update(vad)


class CaptureUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class InterviewCapture:
    def __init__(self, state: dict, send: Callable[..., Awaitable[dict]], publish: Callable[..., Awaitable[None]],
                 *, settle: float = SETTLE_SECONDS, max_barrier: float = MAX_BARRIER_SECONDS,
                 unresolved_wait: float = UNRESOLVED_WAIT_SECONDS, vad_tail: float = VAD_TAIL_SECONDS,
                 grace: float = BOUNDARY_GRACE_SECONDS, poll: float = POLL_SECONDS):
        self.state = state
        self.send = send
        self.publish = publish
        self.index = state["nextTurnIndex"]
        self.pending = deque()
        self.open_interims = []  # recognizer segments with an interim and no final yet (start time, or None)
        self.pending_audio = False
        self.accepting = False
        self.attached = False
        self.worker = None
        self.error = None
        self.lock = asyncio.Lock()
        self.finished_requests = {}
        self.sealed = False
        self.settle, self.max_barrier, self.unresolved_wait, self.vad_tail, self.grace, self.poll = (
            settle, max_barrier, unresolved_wait, vad_tail, grace, poll)
        self.last_activity = 0.0
        self.last_final_at = None
        self.speech_active = False
        self.transcript_since_speech = True
        self.voiced_at = None      # wall-clock start of the latest voiced audio
        self.voice_started = None  # wall-clock start of the current voice-activity run
        self.unresolved_voiced = 0.0  # seconds of voice activity that no transcript has covered yet
        self.covered_until = None  # wall-clock end of the latest audio a provider final covers
        self.answer_words = 0      # provider finals with words for the open answer in this connection
        self.prior_speech = bool(state.get("attemptHasSpeech"))
        self.speaking = None
        self.reading_stopped = False  # set by Pause or End; cleared when that save fails and the practice goes on

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    @property
    def pending_interim(self) -> bool:
        return bool(self.open_interims)

    def _reset_speech(self) -> None:
        self.unresolved_voiced, self.voice_started = 0.0, None
        self.open_interims = []
        self.pending_audio = False
        self.speech_active = False
        self.transcript_since_speech = True
        self.voiced_at = None
        self.covered_until = None
        self.last_final_at = None

    def observe_provider_transcript(self, text: str, is_final: bool, *, start: float | None = None,
                                    end: float | None = None, word_end: float | None = None) -> None:
        """start, end and word_end are wall-clock times of the audio, when the provider reported timing."""
        if not self.accepting:
            return
        words = bool(text and text.strip())
        timed = start is not None and end is not None
        reached = (word_end if word_end is not None else end) if timed else None
        # Without timing (tests, or a provider without timestamps) a transcript is assumed to cover everything
        # heard before it arrived.
        covers = not timed or self.voiced_at is None or reached >= self.voiced_at - COVERAGE_MARGIN_SECONDS
        if not is_final:
            if words:
                self.last_activity = self._now()
                self.open_interims.append(start if timed else None)
                if covers:
                    self.transcript_since_speech = True
                    self.unresolved_voiced = 0.0
            return
        # A provider final (even an empty one) completes its recognizer segment and any earlier one; only one
        # with words becomes part of the answer. An interim of a later segment stays pending.
        self.last_activity = self.last_final_at = self._now()
        self.open_interims = [s for s in self.open_interims if timed and s is not None and s > start + SEGMENT_TOLERANCE_SECONDS]
        self.covered_until = max(self.covered_until or 0.0, reached if timed else time.time())
        if covers:
            self.transcript_since_speech = True
            self.pending_audio = False
            self.unresolved_voiced = 0.0
        if not words:
            return
        item = {"attemptId": self.state["attempt"]["id"], "body": {
            "segmentId": self.state["segmentId"], "sourceTurnId": f"user_turn_{self.index}",
            "localTurnIndex": self.index, "role": "user", "text": text,
        }}
        self.index += 1
        self.answer_words += 1
        self.pending.append(item)
        self._start_worker()

    def observe_speech_start(self, at: float | None = None) -> None:
        if self.accepting:
            self.pending_audio = True
            self.transcript_since_speech = False
            self.voiced_at = self.voice_started = at if at is not None else time.time()
            self.last_activity = self._now()
            # A start processed after the detach comes from audio sent before it and cannot still be going on.
            self.speech_active = self.attached

    def observe_speech_end(self, at: float | None = None) -> None:
        self.speech_active = False
        if self.accepting:
            self.last_activity = self._now()
            if self.voice_started is not None and not self.transcript_since_speech:
                self.unresolved_voiced += max(0.0, (at if at is not None else time.time()) - self.voice_started)
        self.voice_started = None

    @property
    def unresolved_speech(self) -> bool:
        """Voiced audio that no transcript covers yet (possibly noise, possibly words)."""
        return self.pending_audio and not self.transcript_since_speech

    def _detach(self, session) -> None:
        session.input.set_audio_enabled(False)
        self.attached = False
        self.speech_active = False

    def enable_input(self, session) -> None:
        """Re-open room audio for the open answer with a fresh voice-activity state."""
        reset_voice_activity(session)
        self.attached = True
        self.speech_active = False
        session.input.set_audio_enabled(True)

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

    async def _await_complete_speech(self, detached_at: float, bound: float, settle: float, ignore_audio: bool = False):
        """Return None once provider-final speech is complete, else the pending reason after the bound.

        ignore_audio skips only voice activity that never produced any transcript; pending partial text is
        still waited for, for the full bound."""
        deadline = detached_at + bound
        while True:
            now = self._now()
            if not self.pending_interim and (ignore_audio or not self.pending_audio) and now - max(self.last_activity, detached_at) >= settle:
                return None
            if now >= deadline:
                return "interim" if self.pending_interim else "speech"
            await asyncio.sleep(self.poll)

    async def drain(self, session, action: str, request_id: str, *, accept_unresolved: bool = False,
                    accept_vad_only: bool = False) -> dict:
        """Save everything finalised before the boundary and record a receipt for exactly those turns.

        accept_unresolved is the learner's explicit choice, after TRANSCRIPT_PENDING, to save only the
        confirmed speech. accept_vad_only is the coordinator's bounded wait for a short sound that never
        produced any transcript (see InterviewCoordinator): pending partial text is still waited for in full,
        and no transcribed word is ever dropped.
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
            # With no open answer (after a Skip or a saved Finish, or while a question is read) there is no
            # speech to wait for.
            open_answer = self.accepting
            ambiguous = False
            if open_answer and self.speech_active:
                gap = None if self.covered_until is None else time.time() - self.covered_until
                if not self.transcript_since_speech or gap is None or gap > self.vad_tail:
                    # Voice beyond VAD's tail after the last transcribed word: a provider final must follow.
                    self.pending_audio = True
                    self.transcript_since_speech = False
                else:
                    # VAD's trailing silence, or new words without a transcript yet: give the recognizer longer.
                    ambiguous = True
            flags = (self.pending_interim, self.pending_audio)
            reason = None
            if action == "SKIP":
                # Skipped speech is never saved; stop accepting now so none of it can reach a later answer.
                self.accepting = False
                self._detach(session)
            else:
                if open_answer:
                    # Audio captured before the request can still be in transit; let it reach the recognizer.
                    await asyncio.sleep(self.grace)
                # The boundary: no new room audio reaches the recognizer after this point.
                self._detach(session)
                if open_answer:
                    reason = await self._await_complete_speech(self._now(), self.unresolved_wait if accept_unresolved else self.max_barrier,
                                                               self.settle + (self.vad_tail if ambiguous else 0.0), ignore_audio=accept_vad_only)
            barrier_ms = round((self._now() - started) * 1000)
            if reason and not accept_unresolved:
                logger.info("interview_drain action=%s outcome=transcript_pending reason=%s barrier_ms=%d pending_interim=%s pending_audio=%s",
                            action, reason, barrier_ms, *flags)
                raise CaptureUnavailable("TRANSCRIPT_PENDING")
            if reason:
                logger.info("interview_drain action=%s outcome=saved_confirmed_only reason=%s barrier_ms=%d", action, reason, barrier_ms)
            elif accept_vad_only and self.pending_audio:
                # Not lost words: a short sound with no transcript at all. The recording keeps it.
                logger.info("interview_drain action=%s outcome=saved_ignoring_untranscribed_sound unresolved_voiced_ms=%d barrier_ms=%d",
                            action, round(self.unresolved_voiced * 1000), barrier_ms)
            if action == "FINISH" and open_answer and not self.answer_words and not self.prior_speech:
                # Nothing has been said for this answer: keep it open instead of storing an empty completion.
                self.enable_input(session)
                logger.info("interview_drain action=FINISH outcome=no_speech barrier_ms=%d", barrier_ms)
                raise CaptureUnavailable("NO_SPEECH")
            # Later speech belongs to no answer: the receipt below must cover exactly the saved turns.
            self.accepting = False
            self._start_worker()
            await self.worker
            flushed = self._now()
            if self.error or self.pending:
                self.accepting = open_answer and action != "SKIP"
                raise CaptureUnavailable("SAVE_FAILED")
            result = await self.send(f"/attempts/{self.state['attempt']['id']}/receipts", {
                "id": request_id, "segmentId": self.state["segmentId"], "action": action,
                "lastTurnIndex": self.index - 1,
            })
            done = self._now()
            if action in {"PAUSE", "LEAVE"}:
                self.sealed = True
            # The boundary is saved: nothing earlier can still be pending for a later Pause or End.
            self._reset_speech()
            receipt = {"receiptId": result["id"], "action": action, "attemptId": self.state["attempt"]["id"],
                       "segmentId": self.state["segmentId"]}
            self.finished_requests[request_id] = receipt
            logger.info("interview_drain action=%s outcome=saved barrier_ms=%d flush_ms=%d receipt_ms=%d total_ms=%d pending_interim=%s pending_audio=%s",
                        action, barrier_ms, round((flushed - started) * 1000) - barrier_ms, round((done - flushed) * 1000),
                        round((done - started) * 1000), *flags)
            return receipt

    async def activate_question(self, session, state: dict):
        """Read the question, then open input for its answer. Input stays closed if Pause or End interrupted it."""
        async with self.lock:
            if self.sealed:
                raise CaptureUnavailable("SEGMENT_SEALED")
            if self.accepting and self.state["attempt"]["id"] == state["attempt"]["id"]:
                return self.state["attempt"]
            self._detach(session)
            self.accepting = False
            self.state = state
            if state["attempt"]["status"] not in {"PREPARED", "ASKED"}:
                return state["attempt"]
            text = state["attempt"]["question"]["text"]
            interrupted = await self._speak(session, text)
            # Marked asked even when interrupted: the learner heard part of it, and Pause/End receipts need an
            # asked attempt. An interrupted question is read again on resume.
            attempt = await self.send(f"/attempts/{state['attempt']['id']}/asked", {
                "segmentId": state["segmentId"], "questionText": text,
            })
            self.state["attempt"] = attempt
            await self.publish("assistant", text, f"question_{attempt['id']}")
            # Only a raw provider final can clear the pending flags after new speech.
            self._reset_speech()
            self.answer_words = 0
            self.prior_speech = bool(state.get("attemptHasSpeech"))
            if interrupted:
                return attempt
            # Resetting the user turn restarts the recognizer stream, so late results for audio from the
            # previous (finished or skipped) answer can never arrive once this answer accepts speech.
            session.clear_user_turn()
            self.accepting = True
            # An expired practice can resume its existing question. The server
            # fences new questions; keep this answer recordable until drained.
            self.enable_input(session)
            return attempt

    async def _speak(self, session, text: str) -> bool:
        """Speak and report whether Pause, End or a disconnect interrupted it."""
        if self.reading_stopped:
            return True  # Pause or End arrived before the question started playing
        # Keep the handle so Pause, End or a disconnect can stop a long question mid-sentence.
        handle = self.speaking = session.say(text, allow_interruptions=False)
        try:
            await handle
            return getattr(handle, "interrupted", False) is True
        finally:
            self.speaking = None

    def interrupt_speech(self) -> None:
        """Pause or End: stop the question being read, and any that was about to start."""
        self.reading_stopped = True
        handle = getattr(self, "speaking", None)
        if handle is not None and hasattr(handle, "interrupt"):
            handle.interrupt(force=True)

    async def repeat_question(self, session) -> bool:
        """Re-read the open question without creating an attempt; the learner's saved speech is kept."""
        async with self.lock:
            if not self.accepting or self.sealed:
                return False
            self._detach(session)
            try:
                interrupted = await self._speak(session, self.state["attempt"]["question"]["text"])
            except Exception:
                self.enable_input(session)
                raise
            if interrupted:
                return False  # Pause or End is saving this answer; input stays closed
            self.enable_input(session)
            return True


CONTROL_ACTIONS = {"FINISH", "SKIP", "PAUSE", "LEAVE", "NEXT", "REPEAT", "HOLD", "RESUME_AUTO"}


def parse_control(payload: str) -> dict:
    try:
        value = json.loads(payload)
        # attemptId names the answer a conversation control targets; acceptUnresolved is the learner's
        # explicit choice to save just the confirmed speech after TRANSCRIPT_PENDING (Finish, Pause or End).
        if not isinstance(value, dict) or not {"action", "requestId"} <= set(value) <= {"action", "requestId", "attemptId", "acceptUnresolved"}:
            raise ValueError()
        if value["action"] not in CONTROL_ACTIONS:
            raise ValueError()
        if "attemptId" in value and (not isinstance(value["attemptId"], str) or not 0 < len(value["attemptId"]) <= 160):
            raise ValueError()
        if "acceptUnresolved" in value and (value["acceptUnresolved"] is not True or value["action"] not in {"FINISH", "PAUSE", "LEAVE"}):
            raise ValueError()
        UUID(value["requestId"])
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        raise CaptureUnavailable("INVALID_REQUEST")
