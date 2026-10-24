"""Expired-practice voice regression: finish the current answer without starting another."""
import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from interview_voice import run_interview_voice


class InterviewTimeLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_expired_resume_keeps_input_open_until_answer_is_saved(self):
        await self._expired_resume(expire_during_question=False)

    async def test_timer_during_question_does_not_leave_answer_muted(self):
        await self._expired_resume(expire_during_question=True)

    async def _expired_resume(self, expire_during_question):
        state = {
            "runId": "run", "identity": "learner", "segmentId": "segment",
            "nextTurnIndex": 0, "secondsRemaining": 0,
            "voiceProfile": {"backend": "pipeline-bedrock", "sttProvider": "transcribe", "ttsProvider": "polly"},
            "attempt": {"id": "attempt", "status": "ASKED", "question": {"text": "Explain retries."}},
        }
        saved = []
        timer_notice = asyncio.Event()
        handlers = {}
        rpc = {}
        session = Mock()
        session.say = AsyncMock()
        if expire_during_question:
            async def say(*_args, **_kwargs):
                await asyncio.wait_for(timer_notice.wait(), 1)
            session.say.side_effect = say
        session.commit_user_turn = AsyncMock()
        session.on.side_effect = lambda event: lambda handler: handlers.setdefault(event, handler)

        async def publish_data(payload, **_kwargs):
            if json.loads(payload).get("type") == "interview_time_up":
                timer_notice.set()

        local = Mock()
        local.publish_data = AsyncMock(side_effect=publish_data)
        local.set_name = AsyncMock()
        local.set_metadata = AsyncMock()
        local.register_rpc_method.side_effect = lambda name: lambda handler: rpc.setdefault(name, handler)
        room = Mock(name="room")
        room.name = "room"
        room.metadata = '{"interviewRunId":"run"}'
        room.local_participant = local
        room.on.side_effect = lambda _event: lambda handler: handler
        ctx = SimpleNamespace(room=room, add_shutdown_callback=Mock())

        class Response:
            status = 200

            def __init__(self, path, body):
                self.path, self.body = path, body

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                pass

            async def json(self):
                if "/sessions/" in self.path:
                    return state
                saved.append((self.path, self.body))
                if self.path.endswith("/asked"):
                    return state["attempt"]
                return {"id": self.body.get("id", "chunk")}

        http = Mock()
        http.request.side_effect = lambda _method, path, **kwargs: Response(path, kwargs.get("json"))
        client = AsyncMock()
        client.__aenter__.return_value = http

        async def start(**kwargs):
            await kwargs["agent"].on_enter()
            await asyncio.wait_for(timer_notice.wait(), 1)
            # The timer may fire before or after on_enter; neither order may mute
            # the learner. Feed a provider final through the actual STT observer.
            session.input.set_audio_enabled.assert_called_with(True)
            with patch("interview_voice.Agent.default.stt_node") as stt_node:
                from livekit.agents import stt

                async def transcript(*_args):
                    yield stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                        alternatives=[stt.SpeechData(language="en", text="Use bounded retries.")])

                stt_node.side_effect = transcript
                async for _event in kwargs["agent"].stt_node(None, None):
                    pass
            receipt = await rpc["interview.control"](SimpleNamespace(caller_identity="learner",
                payload=json.dumps({"action": "FINISH", "requestId": str(uuid4())})))
            self.assertIn("receiptId", json.loads(receipt))
            self.assertTrue(any(body.get("text") == "Use bounded retries." for _path, body in saved))
            session.input.set_audio_enabled.assert_called_with(False)
            handlers["close"](None)

        session.start = AsyncMock(side_effect=start)
        with patch("interview_voice.aiohttp.ClientSession", return_value=client), \
             patch("interview_voice.build_interview_session", AsyncMock(return_value=SimpleNamespace(session=session))):
            await run_interview_voice(ctx, SimpleNamespace(identity="learner"), "session", "segment")


if __name__ == "__main__":
    unittest.main()
