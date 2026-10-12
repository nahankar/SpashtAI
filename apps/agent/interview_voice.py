"""Voice adapter for the gated bank-question pilot. No communication profile/LLM."""
import asyncio
import json
import logging
import os
import time
from urllib.parse import quote, urlencode
from uuid import uuid4
import aiohttp
from livekit.agents import Agent, stt, room_io
from livekit import rtc
from interview_capture import CaptureUnavailable, InterviewCapture, parse_control
from interview_audio import keep_interview_audio_alive, INTERVIEW_SAMPLE_RATE
from voice_backends import VoiceBackendConfig, build_interview_session

logger = logging.getLogger("spashtai-agent.interview_voice")


async def run_interview_voice(ctx, participant, session_id: str, segment_id: str):
    base = os.getenv("SERVER_URL", "http://localhost:4000").rstrip("/") + "/internal/interviews"
    token = os.getenv("INTERNAL_AGENT_TOKEN", "dev-internal-agent-token")
    active_session = None
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as http:
        async def send(path, body=None, method="POST"):
            for attempt in range(3):
                try:
                    async with http.request(method, base+path, json=body,
                        headers={"x-internal-agent-token": token}) as response:
                        if response.status < 400:
                            return await response.json()
                        if response.status < 500 and response.status != 429:
                            if active_session is not None:
                                active_session.input.set_audio_enabled(False)
                                await ctx.room.local_participant.publish_data(json.dumps({"type":"interview_error",
                                    "text":"Interview speech capture is unavailable. Retry saving or end with an incomplete answer."}).encode(), topic="lk.control")
                            raise CaptureUnavailable("ACCESS_OR_CAPTURE_UNAVAILABLE")
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    pass
                if attempt < 2:
                    await asyncio.sleep(.5 * (2 ** attempt))
            raise CaptureUnavailable("SAVE_FAILED")

        query = urlencode({"room": ctx.room.name, "identity": participant.identity})
        state_path = f"/sessions/{quote(session_id, safe='')}/segments/{quote(segment_id, safe='')}?{query}"
        state = await send(state_path, method="GET")
        if state["identity"] != participant.identity or state["runId"] != json.loads(ctx.room.metadata).get("interviewRunId"):
            raise CaptureUnavailable("ROOM_OWNERSHIP_MISMATCH")
        profile = state["voiceProfile"]
        cfg = VoiceBackendConfig.from_room_meta({"voiceBackend": profile["backend"], **profile})
        build = await build_interview_session(cfg)
        session = build.session
        active_session = session
        closed = asyncio.Event()

        async def publish(role, text, message_id):
            try:
                await ctx.room.local_participant.publish_data(json.dumps({"type": role, "text": text, "final": True,
                    "id": message_id, "timestamp": int(time.time()*1000)}).encode(), topic="lk.conversation")
            except Exception:
                # UI delivery is independent of successful durable speech storage.
                logger.warning("Interview text notification unavailable")

        capture = InterviewCapture(state, send, publish)
        question_task = None
        async def ready():
            await ctx.room.local_participant.publish_data(json.dumps({"type": "session_state", "text": "ready"}).encode(), topic="lk.control")
        @session.on("user_state_changed")
        def speech_started(event):
            if event.new_state == "speaking":
                capture.observe_speech_start()

        class InterviewAgent(Agent):
            def __init__(self):
                super().__init__(instructions="Read only saved interview questions. Wait for explicit user controls; never invent feedback.")

            async def stt_node(self, audio, model_settings):
                async for event in Agent.default.stt_node(self, keep_interview_audio_alive(audio), model_settings):
                    if isinstance(event, stt.SpeechEvent) and event.alternatives:
                        if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                            capture.observe_provider_transcript(event.alternatives[0].text, True)
                        elif event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                            capture.observe_provider_transcript(event.alternatives[0].text, False)
                    yield event

            async def on_enter(self):
                await capture.activate_question(session, state)
                await ready()

        @ctx.room.local_participant.register_rpc_method("interview.control")
        async def control(data: rtc.RpcInvocationData):
            nonlocal question_task
            if data.caller_identity != state["identity"]:
                raise rtc.RpcError(1500, "Interview access denied")
            try:
                body = parse_control(data.payload)
                if closed.is_set():
                    return json.dumps({"error": "VOICE_DISCONNECTED"})
                if body["action"] == "NEXT":
                    if question_task is not None and not question_task.done():
                        return json.dumps({"asking": True})
                    fresh = await send(state_path, method="GET")
                    async def ask_saved_question():
                        try:
                            await capture.activate_question(session, fresh)
                            await ready()
                        except Exception:
                            logger.warning("Saved interview question could not be spoken")
                            await ctx.room.local_participant.publish_data(json.dumps({"type": "session_state", "text": "greeting_failed"}).encode(), topic="lk.control")
                    question_task = asyncio.create_task(ask_saved_question())
                    return json.dumps({"asking": True})
                return json.dumps(await capture.drain(session, body["action"], body["requestId"]))
            except CaptureUnavailable as error:
                return json.dumps({"error": error.code})
            except Exception as error:
                logger.warning("Interview control failed without a save acknowledgement (%s)", type(error).__name__)
                return json.dumps({"error": "SAVE_FAILED"})

        await ctx.room.local_participant.set_name("SpashtAI Interviewer")
        await ctx.room.local_participant.set_metadata(json.dumps({"type": "assistant", "interviewRunId": state["runId"],
            "sessionId": session_id, "segmentId": segment_id, "model": "Interview voice"}))
        room_options = room_io.RoomOptions(participant_identity=participant.identity, close_on_disconnect=False,
            audio_input=room_io.AudioInputOptions(sample_rate=INTERVIEW_SAMPLE_RATE, frame_size_ms=50))
        if profile.get("hushEnabled"):
            from hush_audio import prepare_hush_audio
            runtime = prepare_hush_audio(requested=True)
            if runtime.effective and runtime.processor is not None:
                room_options = room_io.RoomOptions(participant_identity=participant.identity, close_on_disconnect=False,
                    audio_input=room_io.AudioInputOptions(sample_rate=16000, frame_size_ms=50, noise_cancellation=runtime.processor))

        async def shutdown():
            if capture.sealed or (not capture.accepting and not capture.pending and not capture.pending_interim and not capture.pending_audio):
                return
            try:
                # The server allows only the same unfinished attempt's bounded
                # disconnect drain; ending/discarding still fences all writes.
                await asyncio.wait_for(capture.drain(session, "PAUSE", str(uuid4())), timeout=25)
            except Exception:
                logger.warning("Interview disconnect capture remains incomplete")

        ctx.add_shutdown_callback(shutdown)
        async def duration_limit():
            await asyncio.sleep(state["secondsRemaining"])
            capture.time_up = True
            session.input.set_audio_enabled(False)
            await ctx.room.local_participant.publish_data(json.dumps({"type":"interview_time_up",
                "text":"Practice time is up. Finish your current answer or end practice."}).encode(), topic="lk.control")
        duration_task = asyncio.create_task(duration_limit())
        @ctx.room.on("participant_disconnected")
        def disconnected(remote):
            if remote.identity != participant.identity:
                return
            async def drain_and_close():
                await shutdown()
                await session.aclose()
                closed.set()
            asyncio.create_task(drain_and_close())
        @session.on("close")
        def session_closed(_event):
            closed.set()
            async def notify_closed():
                try:
                    await ctx.room.local_participant.publish_data(json.dumps({"type": "interview_voice_closed"}).encode(), topic="lk.control")
                except Exception:
                    pass
            asyncio.create_task(notify_closed())
        await session.start(room=ctx.room, agent=InterviewAgent(), room_options=room_options)
        await closed.wait()
        duration_task.cancel()
        if question_task is not None and not question_task.done():
            question_task.cancel()
