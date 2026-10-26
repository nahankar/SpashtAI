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
from interview_coordinator import InterviewCoordinator, ServerRefused
from interview_audio import ProviderClock, RecognizerWatch, keep_interview_audio_alive, supervise_recognizer, INTERVIEW_SAMPLE_RATE
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

        async def request(path, body=None, method="POST"):
            """Coordinator calls: expected refusals (time up, bank exhausted, access) carry their code."""
            for attempt in range(3):
                try:
                    async with http.request(method, base+path, json=body,
                        headers={"x-internal-agent-token": token}) as response:
                        try:
                            payload = await response.json()
                        except (aiohttp.ContentTypeError, json.JSONDecodeError, ValueError):
                            payload = {}
                        if response.status < 400:
                            return payload
                        if response.status < 500 and response.status != 429:
                            raise ServerRefused(response.status, (payload or {}).get("code"))
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

        # Automatic conversation only for runs that pinned it and still have access; others stay manual.
        # A pinned run keeps its pinned save-barrier timings either way.
        conversation = state.get("conversation") or {}
        policy = conversation.get("policy") or {}
        timings = {"settle": policy["settleMs"] / 1000, "max_barrier": policy["maxBarrierMs"] / 1000} if policy else {}
        capture = InterviewCapture(state, send, publish, **timings)
        question_task = None
        async def ready():
            await ctx.room.local_participant.publish_data(json.dumps({"type": "session_state", "text": "ready"}).encode(), topic="lk.control")

        async def publish_state(name, extra):
            # Participant attributes persist across reconnects; the data message is only a prompt to re-read.
            values = {k: ("1" if v is True else "" if v is False else str(v)) for k, v in extra.items()}
            attributes = {f"interview.{key}": values.get(key, "") for key in ("attemptId", "reason", "handoffAt", "hold", "receiptId", "receiptAction")}
            await ctx.room.local_participant.set_attributes({"interview.state": name, **attributes})
            await ctx.room.local_participant.publish_data(json.dumps({"type": "interview_state", "state": name, **values}).encode(), topic="lk.control")
            if name == "listening":
                await ready()

        coordinator = InterviewCoordinator(capture=capture, session=session, request=request,
            voice_state=lambda: send(state_path, method="GET"), publish_state=publish_state, run_id=state["runId"],
            policy=policy, attempt_has_speech=bool(state.get("attemptHasSpeech"))) if conversation.get("enabled") else None

        def conversing() -> bool:
            # Withdrawn access turns the coordinator off mid-practice; the learner continues manually.
            return coordinator is not None and coordinator.active

        recognizer_watch = RecognizerWatch()

        @session.on("user_state_changed")
        def speech_started(event):
            if event.new_state == "speaking":
                capture.observe_speech_start(event.created_at)
                recognizer_watch.speech_started(event.created_at)
            elif event.old_state == "speaking":
                capture.observe_speech_end(event.created_at)
            if conversing() and (event.new_state == "speaking" or event.old_state == "speaking"):
                coordinator.on_vad(event.new_state == "speaking")

        class InterviewAgent(Agent):
            def __init__(self):
                super().__init__(instructions="Read only saved interview questions. Wait for explicit user controls; never invent feedback.")

            async def stt_node(self, audio, model_settings):
                # Each recognizer stream gets its own clock; question changes, and a stream that stops
                # returning results while the learner speaks, restart the stream.
                clock = ProviderClock(time.time())

                def opened(at: float):
                    nonlocal clock
                    clock = ProviderClock(at)

                recognizer_watch.reset()
                async for event in supervise_recognizer(keep_interview_audio_alive(audio),
                        lambda frames: Agent.default.stt_node(self, frames, model_settings), recognizer_watch, opened):
                    if isinstance(event, stt.SpeechEvent) and event.type in {stt.SpeechEventType.FINAL_TRANSCRIPT, stt.SpeechEventType.INTERIM_TRANSCRIPT}:
                        recognizer_watch.result()
                    if isinstance(event, stt.SpeechEvent) and event.alternatives:
                        alternative = event.alternatives[0]
                        has_words = bool(alternative.text and alternative.text.strip())
                        if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                            capture.observe_provider_transcript(alternative.text, True, **clock.timing(alternative))
                            if conversing():
                                coordinator.on_transcript(True, has_words)
                        elif event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                            capture.observe_provider_transcript(alternative.text, False, **clock.timing(alternative))
                            if conversing() and has_words:
                                coordinator.on_transcript(False)
                    yield event

            async def on_enter(self):
                if conversing():
                    try:
                        await coordinator.begin(state, state.get("unfinishedReceipt"))
                    except Exception:
                        # The coordinator has published a waiting state the learner can continue from.
                        logger.warning("Interview conversation could not resume automatically")
                    return
                await capture.activate_question(session, state)
                if capture.accepting:
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
                action = body["action"]
                unresolved = body.get("acceptUnresolved", False)
                if action in {"PAUSE", "LEAVE"}:
                    # Stop a question mid-sentence; the answer it belongs to stays open and is re-read on resume.
                    capture.interrupt_speech()
                    try:
                        if conversing():
                            # No automatic handoff or advance from here; an in-flight save finishes first so
                            # this receipt names a settled answer and no unheard question is created.
                            coordinator.suspend()
                            async with coordinator.lock:
                                capture.interrupt_speech()
                                receipt = await capture.drain(session, action, body["requestId"], accept_unresolved=unresolved)
                            coordinator.stop()
                            return json.dumps(receipt)
                        return json.dumps(await capture.drain(session, action, body["requestId"], accept_unresolved=unresolved))
                    except Exception:
                        # The learner retries Pause or End (automatic progression stays off); questions may be read again.
                        capture.reading_stopped = False
                        raise
                if action == "REPEAT":
                    return json.dumps({"repeated": await (coordinator.repeat() if conversing() else capture.repeat_question(session))})
                if action in {"HOLD", "RESUME_AUTO"}:
                    if conversing():
                        coordinator.set_hold(action == "HOLD")
                    return json.dumps({"hold": action == "HOLD"})
                if conversing() and action in {"FINISH", "SKIP"}:
                    return json.dumps(await coordinator.complete(action, body["requestId"], body.get("attemptId"),
                                                                 accept_unresolved=unresolved))
                if conversing() and action == "NEXT":
                    # The coordinator owns questions in conversation runs; a bare NEXT (transport recovery) is a no-op.
                    if body.get("attemptId"):
                        return json.dumps(await coordinator.next_after(body["attemptId"]))
                    return json.dumps({"asking": coordinator.state == "asking"})
                if body["action"] == "NEXT":
                    if question_task is not None and not question_task.done():
                        return json.dumps({"asking": True})
                    fresh = await send(state_path, method="GET")
                    async def ask_saved_question():
                        try:
                            await capture.activate_question(session, fresh)
                            if capture.accepting:
                                await ready()
                        except Exception:
                            logger.warning("Saved interview question could not be spoken")
                            await ctx.room.local_participant.publish_data(json.dumps({"type": "session_state", "text": "greeting_failed"}).encode(), topic="lk.control")
                    question_task = asyncio.create_task(ask_saved_question())
                    return json.dumps({"asking": True})
                return json.dumps(await capture.drain(session, body["action"], body["requestId"],
                                                      accept_unresolved=body.get("acceptUnresolved", False)))
            except CaptureUnavailable as error:
                return json.dumps({"error": error.code})
            except ServerRefused as error:
                return json.dumps({"error": error.code or "SERVER_REFUSED"})
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
            # Leave the current answer open, including when a resumed segment
            # starts with zero time remaining. New questions are server-fenced.
            await ctx.room.local_participant.publish_data(json.dumps({"type":"interview_time_up",
                "text":"Practice time is up. Finish your current answer or end practice."}).encode(), topic="lk.control")
        # No time limit (Ultra): the server sends secondsRemaining null, so no timer runs. The question cap still applies.
        duration_task = asyncio.create_task(duration_limit()) if state.get("secondsRemaining") is not None else None
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
        if duration_task is not None:
            duration_task.cancel()
        if question_task is not None and not question_task.done():
            question_task.cancel()
