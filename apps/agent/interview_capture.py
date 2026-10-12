"""Interview-only committed speech queue and explicit save barrier.

Provider-final STT events are authoritative. SDK manual-commit output (which
may contain promoted interim text after timeout) is never used as answer text.
"""
import asyncio
import json
from collections import deque
from typing import Awaitable, Callable
from uuid import UUID


class CaptureUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class InterviewCapture:
    def __init__(self, state: dict, send: Callable[..., Awaitable[dict]], publish: Callable[..., Awaitable[None]]):
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
        self.time_up = False

    def observe_provider_transcript(self, text: str, is_final: bool) -> None:
        if not self.accepting or not text or not text.strip():
            return
        if not is_final:
            self.pending_interim = True
            return
        self.pending_interim = False
        self.pending_audio = False
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

    def _start_worker(self):
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._flush())

    async def _flush(self):
        self.error = None
        while self.pending:
            item = self.pending[0]
            try:
                await self.send(f"/attempts/{item['attemptId']}/chunks", item["body"])
                await self.publish("user", item["body"]["text"], item["body"]["sourceTurnId"])
            except Exception:
                self.error = "SAVE_FAILED"
                return
            self.pending.popleft()

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
            # Detaching audio makes the SDK append silence to flush streaming STT.
            session.input.set_audio_enabled(False)
            try:
                await asyncio.wait_for(session.commit_user_turn(
                    transcript_timeout=8.0, stt_flush_duration=2.0, skip_reply=True,
                ), timeout=12.0)
            except Exception:
                raise CaptureUnavailable("TRANSCRIPT_PENDING")
            # Keep accepting delayed provider finals while the input is detached.
            if self.pending_interim or self.pending_audio:
                raise CaptureUnavailable("TRANSCRIPT_PENDING")
            self._start_worker()
            await self.worker
            if self.error or self.pending:
                raise CaptureUnavailable("SAVE_FAILED")
            result = await self.send(f"/attempts/{self.state['attempt']['id']}/receipts", {
                "id": request_id, "segmentId": self.state["segmentId"], "action": action,
                "lastTurnIndex": self.index - 1,
            })
            self.accepting = False
            if action in {"PAUSE", "LEAVE"}:
                self.sealed = True
            receipt = {"receiptId": result["id"], "action": action, "attemptId": self.state["attempt"]["id"],
                       "segmentId": self.state["segmentId"]}
            self.finished_requests[request_id] = receipt
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
            self.accepting = True
            session.clear_user_turn()
            session.input.set_audio_enabled(not self.time_up)
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
