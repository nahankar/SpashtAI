#!/usr/bin/env python3

"""
SpashtAI Voice Agent - AWS Nova Sonic with transcripts + database logging
Combines proven audio pattern with enhanced transcript handling
"""

import asyncio
import atexit
import json
import logging
import os
import signal
import time
import aiohttp
import subprocess
from datetime import datetime
from typing import Optional
import pytz

from dotenv import load_dotenv
from livekit import rtc, api
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents import AgentSession, Agent, function_tool, RunContext, llm, stt
from livekit.agents.llm import StopResponse
from livekit.agents.voice.agent import ModelSettings
from livekit.plugins import aws
from exercise_templates import get_exercise_instructions
from monologue_guard import MONOLOGUE_FOCUS_AREAS, MonologueGuard
from echo_guard import is_likely_echo, record_assistant_speech
from text_sanitize import StreamingThinkingStripper, is_thinking_only, strip_thinking_blocks
from voice_backends import VoiceBackendConfig, apply_turn_detection_update, build_session, metadata_label
from backend_profiles import BackendProfile, SttMode, profile_for
from live_pacing import LivePacingTracker

# Import analytics components (includes basic + advanced metrics)
try:
    from advanced_metrics_collector import AdvancedMetricsCollector
    ADVANCED_ANALYTICS_AVAILABLE = True
    logger_init = logging.getLogger("main")
    logger_init.info("✅ Advanced analytics components available (spaCy, Praat, Gentle + basic metrics)")
except ImportError as e:
    ADVANCED_ANALYTICS_AVAILABLE = False
    logger_init = logging.getLogger("main")
    logger_init.warning(f"⚠️ Advanced analytics not available: {e}")
    logger_init.warning("⚠️ Install with: pip install spacy praat-parselmouth && python -m spacy download en_core_web_lg")

# Start the Signal Extraction API (Metrics Engine v2)
# Guard: only start in the main process (LiveKit dev mode spawns child processes via multiprocessing).
#
# SIGNAL_API_INPROCESS=0 runs it as a SEPARATE process instead (see `npm run dev`).
# That is required for prosody analysis: analyze_prosody shells out to ffmpeg, and a
# blocking subprocess inside this asyncio worker process hangs on child-reaping
# (it runs fine in a standalone process). Decoupling also keeps one wedged request
# from blocking the whole service.
import multiprocessing as _mp
if _mp.current_process().name == "MainProcess" and os.getenv("SIGNAL_API_INPROCESS", "1") != "0":
    try:
        from analytics.signal_api import start_signal_api
        start_signal_api(blocking=False)
        logger_init = logging.getLogger("main")
        logger_init.info("✅ Signal extraction API started in-process (spaCy + textstat)")
    except Exception as e:
        logger_init = logging.getLogger("main")
        logger_init.warning(f"⚠️ In-process Signal API not started: {e}")
        logger_init.warning("⚠️ Run it standalone with: python -m analytics.signal_api")
else:
    logging.getLogger("main").info(
        "ℹ️ In-process Signal API disabled (SIGNAL_API_INPROCESS=0) — expecting a standalone signal service on :4001"
    )

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

# Server configuration
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
INTERNAL_AGENT_TOKEN = os.getenv("INTERNAL_AGENT_TOKEN", "dev-internal-agent-token")

# Empirical AWS Transcribe finalize/transcription lag (seconds): a FINAL
# transcript is delivered roughly this long after the audio it covers. Used to
# pin the STT timeline's t0 to wall-clock for replay/karaoke alignment.
_STT_FINALIZE_LAG_SEC = 1.1

# Timezone configuration - Indian Standard Time
IST = pytz.timezone('Asia/Kolkata')

def get_ist_now():
    """Get current datetime in IST"""
    return datetime.now(IST)

def to_ist_isoformat(dt: datetime = None) -> str:
    """Convert datetime to IST ISO format string"""
    if dt is None:
        dt = datetime.now(IST)
    elif dt.tzinfo is None:
        # If naive datetime, assume UTC and convert to IST
        dt = pytz.utc.localize(dt).astimezone(IST)
    else:
        # If aware datetime, convert to IST
        dt = dt.astimezone(IST)
    return dt.isoformat()


def _recording_bucket() -> str:
    """S3 bucket for LiveKit egress recordings.

    Must match the bucket in egress.yaml (s3.bucket / S3_RECORDING_BUCKET).
    Previously this was hardcoded to the placeholder 'your-bucket', which made
    every recording target a non-existent bucket and broke delivery analysis.
    """
    return os.getenv("S3_RECORDING_BUCKET", "spashtai-s3-prod")


async def fetch_session_history(session_id: str, max_messages: int = 12) -> list[dict]:
    """
    Fetch prior conversation messages for a session from server.
    Returns the most recent messages in chronological order.
    """
    url = f"{SERVER_URL}/internal/sessions/{session_id}/conversation"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                timeout=aiohttp.ClientTimeout(total=5.0),
            ) as response:
                if response.status != 200:
                    logger.warning("⚠️ History lookup failed for %s: HTTP %s", session_id, response.status)
                    return []
                payload = await response.json()
                messages = payload.get("messages", [])
                if not isinstance(messages, list):
                    return []
                if max_messages > 0:
                    return messages[-max_messages:]
                return messages
    except Exception as e:
        logger.warning("⚠️ Failed to fetch session history: %s", e)
        return []


async def fetch_session_ended(session_id: str) -> bool:
    """Return True if the session is already finalized (endedAt set).

    Used to refuse resuming a finalized session — otherwise a re-dispatch or
    reconnect can spawn a phantom duplicate job on a dead session that just
    burns resources and crashes on the no-audio STT timeout. Fails open
    (returns False) so a transient lookup error never blocks a real session.
    """
    url = f"{SERVER_URL}/internal/sessions/{session_id}/conversation"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                timeout=aiohttp.ClientTimeout(total=5.0),
            ) as response:
                if response.status != 200:
                    return False
                payload = await response.json()
                return bool(payload.get("ended"))
    except Exception as e:
        logger.warning("⚠️ Failed to check session ended-state: %s", e)
        return False


def _debug_log(msg: str):
    """Write debug messages to a file so they're visible even from child processes."""
    try:
        with open("/tmp/spashtai_agent_debug.log", "a") as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


async def fetch_coaching_context(session_id: str, focus_area: str, max_retries: int = 3) -> dict | None:
    """
    Fetch rich coaching context (skill scores, metrics, example phrases, etc.)
    from the server for personalized Elevate exercises.
    Retries on failure since the session DB record may not exist yet.
    """
    url = f"{SERVER_URL}/internal/coaching-context"
    _debug_log(f"fetch_coaching_context called: session_id={session_id}, focus_area={focus_area}, url={url}")
    for attempt in range(max_retries):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    params={"sessionId": session_id, "focusArea": focus_area},
                    headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                    timeout=aiohttp.ClientTimeout(total=5.0),
                ) as response:
                    _debug_log(f"Response status: {response.status} (attempt {attempt+1}/{max_retries})")
                    if response.status == 404 and attempt < max_retries - 1:
                        logger.info("⏳ Session not found yet, retrying in %ds... (attempt %d/%d)",
                            attempt + 1, attempt + 1, max_retries)
                        await asyncio.sleep(attempt + 1)
                        continue
                    if response.status != 200:
                        body = await response.text()
                        _debug_log(f"Non-200 response body: {body[:500]}")
                        logger.warning("⚠️ Coaching context fetch failed: HTTP %s (attempt %d/%d)",
                            response.status, attempt + 1, max_retries)
                        if attempt < max_retries - 1:
                            await asyncio.sleep(attempt + 1)
                            continue
                        return None
                    data = await response.json()
                    skills = data.get("skillSummaries", {})
                    replay = data.get("replayInsights")
                    _debug_log(f"SUCCESS: {len(skills)} skills, replay={'yes' if replay else 'no'}")
                    logger.info("📊 Coaching context loaded: %d skills, replay=%s, examples=%d",
                        len(skills),
                        "yes" if replay else "no",
                        len(replay.get("examplePhrases", [])) if replay else 0)
                    return data
        except Exception as e:
            _debug_log(f"Exception: {e}")
            logger.warning("⚠️ Coaching context fetch error (attempt %d/%d): %s",
                attempt + 1, max_retries, e)
            if attempt < max_retries - 1:
                await asyncio.sleep(attempt + 1)
    _debug_log("All retries exhausted, returning None")
    return None


def build_resume_context(history_messages: list[dict]) -> str:
    """Build a compact resume context string from prior messages."""
    if not history_messages:
        return ""

    def clip(text: str, limit: int = 220) -> str:
        text = (text or "").strip().replace("\n", " ")
        if len(text) <= limit:
            return text
        return text[: limit - 3].rstrip() + "..."

    # Normalize and clean messages first.
    normalized = []
    for msg in history_messages:
        role = msg.get("role", "assistant")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        normalized.append({"role": role, "content": content})

    if not normalized:
        return ""

    user_msgs = [m["content"] for m in normalized if m["role"] == "user"]
    assistant_msgs = [m["content"] for m in normalized if m["role"] == "assistant"]

    # Build compact memory summary.
    summary_lines = [
        f"- Conversation so far has {len(normalized)} messages.",
    ]

    if user_msgs:
        summary_lines.append(f"- User recent focus: {clip(user_msgs[-1], 180)}")
        if len(user_msgs) > 1:
            summary_lines.append(f"- Earlier user context: {clip(user_msgs[-2], 180)}")

    # Capture last assistant question, if any.
    last_assistant_question = ""
    for text in reversed(assistant_msgs):
        if "?" in text:
            last_assistant_question = text
            break
    if last_assistant_question:
        summary_lines.append(
            f"- Last assistant question/prompt: {clip(last_assistant_question, 180)}"
        )

    # Keep only recent dialogue snippets to preserve continuity.
    recent_messages = normalized[-6:]
    recent_lines = []
    for msg in recent_messages:
        speaker = "User" if msg["role"] == "user" else "Assistant"
        recent_lines.append(f"{speaker}: {clip(msg['content'], 180)}")

    return (
        "SESSION MEMORY SUMMARY:\n"
        + "\n".join(summary_lines)
        + "\n\nRECENT DIALOGUE SNIPPETS:\n"
        + "\n".join(recent_lines)
        + "\n\nContinue naturally from this context. Do not restart from introductions unless the user asks."
    )


# ─────────────────────────────────────────────────────────────────────────────
# CoachingAgent — Agent subclass that exposes function tools to the LLM.
#
# Today: `get_live_pacing` returns a *measured* WPM derived from VAD events,
# so the model can quote a real number instead of guessing. As we add more
# grounded coaching signals (filler-word counts, pause structure, etc.) we
# will register them here as additional `@function_tool` methods.
# ─────────────────────────────────────────────────────────────────────────────


async def fetch_agent_prompt(key: str) -> str | None:
    """Load admin-editable prompt overlay from the server."""
    url = f"{SERVER_URL}/internal/agent-prompts/{key}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                timeout=aiohttp.ClientTimeout(total=5.0),
            ) as response:
                if response.status != 200:
                    return None
                data = await response.json()
                content = (data.get("content") or "").strip()
                return content or None
    except Exception as e:
        logger.debug("Agent prompt fetch failed for %s: %s", key, e)
        return None


class CoachingAgent(Agent):
    def __init__(
        self,
        instructions: str,
        pacing_tracker: "LivePacingTracker",
        advanced_metrics=None,
        room_getter=None,
        user_name: str | None = None,
        focus_area: str | None = None,
        session_name: str | None = None,
        voice_backend: str = "nova-sonic",
        focus_score: float | None = None,
        monologue_guard: "MonologueGuard | None" = None,
        is_resume: bool = False,
    ) -> None:
        super().__init__(instructions=instructions)
        self._pacing_tracker = pacing_tracker
        # Optional handles used to push a fresh snapshot to the frontend at
        # the exact moment the LLM cites a number — keeps the spoken number
        # and the on-screen card in sync.
        self._advanced_metrics = advanced_metrics
        self._room_getter = room_getter
        self._user_name = user_name
        self._focus_area = focus_area
        self._session_name = session_name
        self._voice_backend = voice_backend
        self._focus_score = focus_score
        self._greeting_sent = False
        self._assistant_speech_history: list[tuple[str, float]] = []
        self._monologue_guard = monologue_guard
        self._last_greeting_text: str | None = None
        self._is_resume = is_resume
        # Accumulated STT word/segment timings (stream-relative seconds), used to
        # build per-turn replay records (SessionTurn) with audio offsets + karaoke
        # word timings at session end. Empty for backends without timestamps.
        self._stt_words: list[dict] = []
        self._stt_segments: list[dict] = []
        # Wall-clock epoch (seconds) corresponding to STT timeline t=0. AWS
        # Transcribe word/segment times are relative to when audio starts
        # flowing (≈ the user's first word, AFTER the greeting), whereas the
        # browser recording starts at room-connect. Persisting this anchor lets
        # the server realign per-turn offsets to the recording timeline so
        # karaoke matches the audio (the lead-in gap is variable per session).
        self._stt_t0_epoch: float | None = None

    async def stt_node(self, audio, model_settings: ModelSettings):
        """Tap the STT stream for real word/segment timestamps.

        AWS Transcribe streaming returns per-segment start/end times and
        word-level timestamps, but the high-level `user_input_transcribed`
        event drops them. We intercept FINAL_TRANSCRIPT events here and feed
        the measured speech duration to the pacing tracker so WPM is computed
        from real timing instead of the VAD-paired 150-WPM estimate fallback.
        Backends without timing (e.g. Whisper) simply never trigger this and
        keep using the VAD path.
        """
        async for ev in Agent.default.stt_node(self, audio, model_settings):
            try:
                if (
                    isinstance(ev, stt.SpeechEvent)
                    and ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
                    and ev.alternatives
                ):
                    self._ingest_stt_word_timing(ev.alternatives[0])
            except Exception as e:  # never let metrics break transcription
                logger.debug("stt word-timing ingest failed: %s", e)
            yield ev

    def _ingest_stt_word_timing(self, alt) -> None:
        text = (getattr(alt, "text", "") or "").strip()
        if not text:
            return
        start = getattr(alt, "start_time", None)
        end = getattr(alt, "end_time", None)
        words = getattr(alt, "words", None)
        word_count = len(words) if words else len(text.split())
        seconds = (end - start) if (start is not None and end is not None and end > start) else None
        self._pacing_tracker.ingest_measured_final(text, word_count, seconds)
        # Persist raw word/segment timings (stream-relative seconds) for the
        # replay timeline. Best-effort: never let capture break transcription.
        try:
            if start is not None and end is not None:
                # Anchor the STT timeline to wall-clock on the first timed
                # segment so the server can realign offsets to the recording
                # start. A FINAL transcript is delivered ~(end + finalize lag)
                # after the stream's t0, so subtract `end` (NOT `start`):
                # using start overshoots t0 by the whole first-utterance duration
                # (seconds), landing karaoke that much late. The residual ~1s
                # finalize/transcription lag is removed by a small constant.
                if self._stt_t0_epoch is None:
                    self._stt_t0_epoch = time.time() - float(end) - _STT_FINALIZE_LAG_SEC
                self._stt_segments.append(
                    {"text": text, "start": float(start), "end": float(end)}
                )
            appended = 0
            if words:
                for w in words:
                    wtext = (
                        getattr(w, "word", None) or getattr(w, "text", "") or ""
                    ).strip()
                    ws = getattr(w, "start_time", None)
                    we = getattr(w, "end_time", None)
                    if wtext and ws is not None and we is not None:
                        self._stt_words.append(
                            {"w": wtext, "start": float(ws), "end": float(we)}
                        )
                        appended += 1
            # AWS Transcribe via the LiveKit plugin exposes segment-level
            # start/end but drops the per-word Items list, so `words` is usually
            # empty. When we have a segment span but no real word timings,
            # synthesize them by distributing the span evenly across tokens.
            # Segments are short (a few words), so this approximation tracks the
            # audio closely enough for karaoke highlighting + per-word seek.
            if appended == 0 and start is not None and end is not None:
                toks = text.split()
                seg_start = float(start)
                seg_span = max(float(end) - seg_start, 0.0)
                per = (seg_span / len(toks)) if (toks and seg_span > 0) else 0.0
                for i, tok in enumerate(toks):
                    ws = seg_start + i * per
                    self._stt_words.append(
                        {"w": tok, "start": ws, "end": ws + per}
                    )
        except Exception as e:
            logger.debug("stt word capture failed: %s", e)

    def opening_greeting_text(self) -> str:
        """Spoken greeting via TTS — no LLM round-trip (reliable on pipeline-bedrock)."""
        # On a resumed session (the user paused then came back) greet with
        # "welcome back" so it doesn't sound like a brand-new first meeting.
        welcome = "welcome back to SpashtAI!" if self._is_resume else "welcome to SpashtAI!"
        if self._user_name:
            line = f"Hello {self._user_name}, {welcome}"
        else:
            line = f"Hello, {welcome}"
        if self._focus_area and self._focus_score is not None:
            line += (
                f" Your {self._focus_area.replace('_', ' ')} score is "
                f"{self._focus_score:.1f} out of 10 — let's work on improving that."
            )
        elif self._focus_area:
            line += f" Today we'll work on your {self._focus_area.replace('_', ' ')}."
        if self._session_name:
            line += f" This session is {self._session_name}."
        line += " When you're ready, go ahead and speak."
        return line

    def opening_greeting_instructions(self) -> str:
        """Prompt for the coach's first spoken turn."""
        greeting_parts = [
            "You are starting a new SpashtAI coaching session.",
            "YOU must speak first — greet the user warmly in one or two short sentences.",
            "Briefly set expectations for what you'll practice today, then invite them to respond when ready.",
            "Keep it conversational and concise — no bullet lists or markdown.",
        ]
        if self._user_name:
            greeting_parts.append(f"Use their name: {self._user_name}.")
        if self._focus_area:
            focus_label = self._focus_area.replace("_", " ")
            greeting_parts.append(f"Mention today's focus area: {focus_label}.")
        if self._session_name:
            greeting_parts.append(f"This session is titled '{self._session_name}'.")
        return " ".join(greeting_parts)

    def _strip_thinking_stream(self, text_stream, *, flush_sentinel: bool = False):
        """Filter an async text stream, dropping <thinking> blocks before TTS/transcripts."""
        stripper = StreamingThinkingStripper()

        async def _filtered():
            async for chunk in text_stream:
                if isinstance(chunk, str):
                    cleaned = stripper.feed(chunk)
                    if cleaned:
                        yield cleaned
                else:
                    text_val = getattr(chunk, "text", None) or str(chunk)
                    cleaned = strip_thinking_blocks(text_val)
                    if cleaned:
                        yield cleaned
            tail = stripper.flush()
            if tail:
                yield tail

        return _filtered()

    def tts_node(self, text, model_settings: ModelSettings):
        """Strip <thinking> before Polly/Kokoro — transcription_node runs too late for audio."""
        return Agent.default.tts_node(
            self, self._strip_thinking_stream(text), model_settings
        )

    def transcription_node(self, text, model_settings: ModelSettings):
        """Strip <thinking> blocks from aligned coach transcripts."""
        stripper = StreamingThinkingStripper()

        async def _filtered():
            async for delta in Agent.default.transcription_node(self, text, model_settings):
                if isinstance(delta, str):
                    cleaned = stripper.feed(delta)
                    if cleaned:
                        yield cleaned
                else:
                    text_val = getattr(delta, "text", None) or str(delta)
                    cleaned = strip_thinking_blocks(text_val)
                    if cleaned:
                        yield cleaned
            tail = stripper.flush()
            if tail:
                yield tail

        return _filtered()

    async def _publish_assistant_line(self, text: str, *, message_id: str | None = None) -> None:
        """Push coach text to lk.conversation — say() alone does not update Elevate chat."""
        room = self._room_getter() if self._room_getter else None
        if room is None or not text.strip():
            return
        try:
            await room.local_participant.publish_data(
                json.dumps({
                    "type": "assistant",
                    "text": text.strip(),
                    "final": True,
                    "id": message_id or f"assistant_{int(time.time() * 1000)}",
                    "timestamp": int(time.time() * 1000),
                }).encode(),
                topic="lk.conversation",
            )
        except Exception as pub_err:
            logger.debug("greeting publish to lk.conversation failed: %s", pub_err)

    async def on_enter(self) -> None:
        # Must await — fire-and-forget tasks get cancelled when on_enter speech task ends.
        await self._send_opening_greeting()

    async def _send_opening_greeting(self) -> None:
        if self._greeting_sent:
            return
        self._greeting_sent = True
        delay = 0.5 if self._voice_backend.startswith("pipeline") else 1.5
        await asyncio.sleep(delay)
        try:
            if self._voice_backend.startswith("pipeline"):
                greeting = self.opening_greeting_text()
                self._last_greeting_text = greeting
                await self.session.say(
                    greeting,
                    allow_interruptions=False,
                )
                record_assistant_speech(self._assistant_speech_history, greeting)
                await self._publish_assistant_line(greeting, message_id="assistant_greeting")
                logger.info("👋 Coach opening greeting via say() [%s]", self._voice_backend)
            else:
                await self.session.generate_reply(
                    instructions=self.opening_greeting_instructions(),
                )
                logger.info("👋 Coach opening greeting via generate_reply [%s]", self._voice_backend)
        except Exception as greet_err:
            self._greeting_sent = False
            logger.error("Opening greeting failed (%s): %s", self._voice_backend, greet_err, exc_info=True)
            try:
                greeting = self.opening_greeting_text()
                self._last_greeting_text = greeting
                await self.session.say(
                    greeting,
                    allow_interruptions=False,
                )
                record_assistant_speech(self._assistant_speech_history, greeting)
                await self._publish_assistant_line(greeting, message_id="assistant_greeting")
                self._greeting_sent = True
                logger.info("👋 Coach opening greeting recovered via say() fallback")
            except Exception as fallback_err:
                logger.error("Opening say() fallback failed: %s", fallback_err)
                room = self._room_getter() if self._room_getter else None
                if room is not None:
                    try:
                        await room.local_participant.publish_data(
                            json.dumps({
                                "type": "session_state",
                                "text": "greeting_failed",
                                "error": str(greet_err)[:200],
                            }).encode(),
                            topic="lk.control",
                        )
                    except Exception:
                        pass

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        """Inject metrics; reject echo phantoms and block coach on invented answers."""
        user_text = (new_message.text_content or "").strip()
        word_count = len(user_text.split())

        if user_text and is_likely_echo(user_text, self._assistant_speech_history):
            logger.warning("🔇 Rejecting likely speaker-echo user turn: %r", user_text[:120])
            raise StopResponse()

        # Transcribe finalizes a turn as the LAST segment only, so `new_message`
        # under-counts a long monologue. Use the cumulative stitched turn text
        # (all fragments so far) for the short-turn check — otherwise a 76-word
        # answer looks "short" and the coach gets StopResponse'd forever.
        cumulative_words = word_count
        if self._advanced_metrics is not None:
            try:
                pending = self._advanced_metrics.basic_collector.peek_pending_user_text()
                if pending:
                    combined = pending if user_text in pending else f"{pending} {user_text}"
                    cumulative_words = len(combined.split())
            except Exception:
                pass

        # NOTE: We intentionally do NOT StopResponse() short turns here anymore.
        # That suppression was for Nova Sonic's ~2s endpointing firing mid-sentence;
        # these pipelines now use patient Silero endpointing (2–4s), so by the time
        # this fires the user has already paused — a real handoff, not a mid-monologue
        # micro-pause. Blocking the coach here caused a deadlock: monologue_active is
        # armed by any user speech and is only cleared by a coach reply, so suppressing
        # the reply meant the coach could never respond to short conversational turns
        # (greetings, "I'm ready", questions). Anti-hallucination is handled below via
        # the [TURN GUARD] instruction, which guides the coach without silencing it.
        guard_parts: list[str] = []
        # Short-turn anti-hallucination guard. This used to be gated to monologue
        # focus areas only, which left conversational/interview sessions wide open:
        # a 2-word "I'm ready" would get fabricated feedback ("your introduction
        # was clear, ~135 WPM") because nothing stopped the model from inventing.
        # Now it fires for every session type. Monologue exercises expect long
        # answers (25+ words), so the bar is higher there; conversational sessions
        # only need to catch non-answers and acknowledgments.
        short_turn_limit = 25 if self._focus_area in MONOLOGUE_FOCUS_AREAS else 12
        if cumulative_words < short_turn_limit:
            guard_parts.append(
                f"The user's last turn was only {cumulative_words} words — a short turn, "
                "not a full spoken answer. Do NOT claim they delivered an introduction, "
                "pitch, or answer, or that they completed an exercise (PREP, signposting, etc.). "
                "Do NOT quote, paraphrase, or invent what they said, and do NOT cite a WPM, "
                "filler count, or any metric for a turn this short. "
                "Respond only to what they actually said; if they have not given a real answer "
                "yet, invite them to begin. If they ask you to recall or quote earlier words you "
                "do not have on record, say so honestly instead of guessing."
            )

        parts: list[str] = []
        snap = self._pacing_tracker.get_live_metrics()
        pacing = snap.to_dict()
        if pacing.get("qualitative") != "not-enough-data":
            wpm_rounded = round(pacing["wpm"] / 5) * 5
            parts.append(
                f"Session pace ~{wpm_rounded} WPM ({pacing['qualitative']}); "
                f"{pacing['total_words']} words in {pacing['total_speaking_seconds']:.0f}s speaking time."
            )
        last = self._pacing_tracker.peek_last_utterance()
        if last:
            last_wpm = round(last.wpm / 5) * 5
            parts.append(
                f"Last utterance ~{last_wpm} WPM ({last.qualitative}), {last.words} words."
            )
        if self._advanced_metrics is not None:
            stats = self._advanced_metrics.basic_collector.get_live_speech_stats()
            if stats.get("last_turn_word_count", 0) > 0:
                parts.append(
                    f"Last turn fillers {stats.get('last_turn_filler_count', 0)}, "
                    f"hedging {stats.get('last_turn_hedging_count', 0)}; "
                    f"session fillers {stats.get('session_filler_count', 0)}."
                )
        if guard_parts:
            turn_ctx.add_message(
                role="system",
                content="[TURN GUARD — follow strictly]\n" + " ".join(guard_parts),
            )
        if parts:
            turn_ctx.add_message(
                role="system",
                content=(
                    "[LIVE METRICS — coach context only; the user sees these on their metrics card. "
                    "Respond immediately with qualitative coaching. Do NOT call get_live_pacing or "
                    "get_speech_metrics unless the user explicitly asks for a precise number.]\n"
                    + " ".join(parts)
                ),
            )

    @function_tool
    async def get_live_pacing(self, context: RunContext) -> dict:
        """Get the user's measured speaking pace (optional fallback).

        The user's app already shows live WPM. Fresh metrics are also injected
        into your context on each user turn — prefer those and respond without
        calling this tool. Only call when the user explicitly asks for a precise
        WPM number and you need confirmation.

        Returns:
            wpm, total_words, total_speaking_seconds, samples, qualitative, ideal_range_wpm.
        """
        snap = self._pacing_tracker.get_live_metrics()
        result = snap.to_dict()
        logger_init = logging.getLogger("spashtai-agent")
        logger_init.info(
            "🛠️  get_live_pacing tool called → wpm=%s words=%s secs=%s qual=%s",
            result["wpm"], result["total_words"], result["total_speaking_seconds"], result["qualitative"],
        )

        # Push the same snapshot to the live-metrics card immediately so the
        # number the user is about to hear matches the number on screen.
        # Fire-and-forget — never block the tool call on this.
        try:
            if self._advanced_metrics is not None and self._room_getter is not None:
                room = self._room_getter()
                if room is not None:
                    asyncio.create_task(self._advanced_metrics.publish_metrics_update(room))
                    logger_init.debug("📡 tool-triggered live-metrics push scheduled")
        except Exception as e:
            logger_init.debug(f"tool-triggered push skipped: {e}")

        return result

    @function_tool
    async def get_speech_metrics(self, context: RunContext) -> dict:
        """Get measured filler, hedging, and acknowledgment counts (optional fallback).

        Live metrics are injected on each user turn and shown on the user's
        metrics card. Only call this if the user explicitly asks for exact counts.
        """
        if self._advanced_metrics is None:
            return {
                "session_filler_count": 0,
                "note": "Metrics not available yet — ask the user to keep speaking.",
            }
        stats = self._advanced_metrics.basic_collector.get_live_speech_stats()
        logging.getLogger("spashtai-agent").info(
            "🛠️  get_speech_metrics → fillers=%s hedging=%s last_turn_fillers=%s",
            stats.get("session_filler_count"),
            stats.get("session_hedging_count"),
            stats.get("last_turn_filler_count"),
        )
        return stats


class ConversationLogger:
    """Minimal conversation logging to server API with IST timestamps"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def log_message(self, role: str, content: str) -> None:
        """Log conversation message to server with IST timestamp"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            payload = {
                "role": role, 
                "content": content,
                "timestamp": to_ist_isoformat()  # Use IST timestamp
            }
            
            async with self.session.post(
                f"{SERVER_URL}/internal/sessions/{self.session_id}/messages",
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5.0)
            ) as response:
                if response.status == 201:
                    logger.info("✅ Saved %s message to database", role)
                else:
                    logger.warning("⚠️ Failed to save message: HTTP %d", response.status)
        except Exception as e:
            logger.warning("⚠️ Failed to save to database: %s", e)
    
    async def close(self):
        if self.session:
            await self.session.close()

class EgressRecorder:
    """Manages Egress participant recording (no Chrome rendering!)"""
    
    def __init__(self, room_name: str, session_id: str, participant_identity: Optional[str] = None, participant_type: str = "user"):
        self.room_name = room_name
        self.session_id = session_id
        self.participant_identity = participant_identity  # Participant ID (user or agent)
        self.participant_type = participant_type  # "user" or "agent"
        self.egress_id: Optional[str] = None
        self.recording_id: Optional[str] = None  # Alias for cleanup check
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")  # Match livekit.yaml
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
        
    async def start_recording(self):
        """Start room recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
                        # Validate participant identity
            if not self.participant_identity:
                logger.error("❌ Participant identity required for recording")
                return None
            
            # Generate filename with session ID and timestamp
            timestamp = int(time.time())
            # Clean participant label (remove prefixes)
            participant_label = self.participant_identity.replace("user-", "").replace("agent-", "")
            filename = f"{self.participant_type}_{participant_label}_{self.session_id}_{timestamp}.mp4"
            filepath = f"/out/{filename}"  # Egress container path
            
            if self.use_s3:
                s3_path = f"s3://{_recording_bucket()}/participant_{self.participant_type}_{self.session_id}_{timestamp}.mp4"
                request = lk_api.ParticipantEgressRequest(
                    room_name=self.room_name,
                    identity=self.participant_identity,
                    file_outputs=[
                        lk_api.EncodedFileOutput(
                            filepath=s3_path,
                            file_type=lk_api.EncodedFileType.MP4
                        )
                    ]
                )
                self.file_path = s3_path
            else:
                request = lk_api.ParticipantEgressRequest(
                    room_name=self.room_name,
                    identity=self.participant_identity,
                    file_outputs=[
                        lk_api.EncodedFileOutput(
                            filepath=filepath,
                            file_type=lk_api.EncodedFileType.MP4
                        )
                    ]
                )
                self.file_path = filepath
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                logger.info(f"🎙️ Starting Participant Egress for {self.participant_type}: {self.participant_identity}")
                egress_info = await egress_service.start_participant_egress(request)
                
                self.egress_id = egress_info.egress_id
                self.recording_id = self.egress_id  # Set alias for cleanup check
                logger.info(f"✅ Started {self.participant_type} Egress recording: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                return self.egress_id
            
        except Exception as e:
            msg = str(e).lower()
            # Egress is a separate LiveKit service (livekit-egress + Redis). It's
            # usually not running in local dev, so a 503/unavailable is expected —
            # log a concise warning instead of a full traceback. Session is unaffected.
            if "unavailable" in msg or "503" in msg or "no response from servers" in msg:
                logger.warning(
                    "🎙️ Egress recording unavailable (server-side recording skipped). "
                    "This is expected without a running livekit-egress service. Session continues."
                )
            else:
                logger.error(f"❌ Failed to start Egress recording: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            # Build stop request
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped recording: {self.egress_id}")
                
                # Return metadata
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Recording metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to stop Egress recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save recording metadata to database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save recording metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save recording metadata: {e}")


class TrackEgressRecorder:
    """Manages Egress track recording - records specific audio track by ID"""
    
    def __init__(self, room_name: str, session_id: str, track_id: Optional[str] = None, participant_type: str = "agent"):
        self.room_name = room_name
        self.session_id = session_id
        self.track_id = track_id  # Audio track ID (e.g., TR_AMxVEQKjm47qSk)
        self.participant_type = participant_type
        self.egress_id: Optional[str] = None
        self.recording_id: Optional[str] = None
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
    
    async def start_recording(self):
        """Start track recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            if not self.track_id:
                logger.error("❌ Track ID required for track recording")
                return None
            
            # Generate filename
            timestamp = int(time.time())
            track_label = self.track_id.replace("TR_", "")[:8]  # Use first 8 chars of track ID
            filename = f"{self.participant_type}_track_{track_label}_{self.session_id}_{timestamp}.mp4"
            filepath = f"/out/{filename}"
            
            if self.use_s3:
                s3_path = f"s3://{_recording_bucket()}/track_{self.participant_type}_{self.session_id}_{timestamp}.mp4"
                request = lk_api.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=self.track_id,
                    file=lk_api.DirectFileOutput(
                        filepath=s3_path,
                        disable_manifest=True
                    )
                )
                self.file_path = s3_path
            else:
                request = lk_api.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=self.track_id,
                    file=lk_api.DirectFileOutput(
                        filepath=filepath,
                        disable_manifest=True
                    )
                )
                self.file_path = filepath
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                logger.info(f"🎙️ Starting Track Egress for {self.participant_type}: {self.track_id}")
                egress_info = await egress_service.start_track_egress(request)
                
                self.egress_id = egress_info.egress_id
                self.recording_id = self.egress_id
                logger.info(f"✅ Started {self.participant_type} Track recording: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                return self.egress_id
                
        except Exception as e:
            logger.error(f"❌ Failed to start Track Egress recording: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active track recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped track recording: {self.egress_id}")
                
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Track recording metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
                
        except Exception as e:
            logger.error(f"❌ Failed to stop track recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save recording metadata to server database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} track metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved track recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save track metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save track metadata: {e}")


class RoomCompositeEgressRecorder:
    """Manages Room Composite Egress recording - records entire room audio/video"""
    
    def __init__(self, room_name: str, session_id: str, participant_type: str = "room_composite"):
        self.room_name = room_name
        self.session_id = session_id
        self.participant_type = participant_type
        self.egress_id: Optional[str] = None
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
    
    async def start_recording(self):
        """Start room composite recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            # Generate timestamp for unique file naming
            timestamp = int(time.time())
            
            # Build file path - using audio-only for now (can be changed to video)
            if self.use_s3:
                self.file_path = f"s3://{_recording_bucket()}/room_{self.room_name}_session_{self.session_id}_{timestamp}.mp4"
            else:
                # Local file output
                self.file_path = f"/out/room_composite_session_{self.session_id}_{timestamp}.mp4"
            
            logger.info(f"🎙️ Starting Room Composite Egress for room: {self.room_name}")
            
            # Create RoomComposite request - audio only for voice calls
            room_composite = lk_api.RoomCompositeEgressRequest(
                room_name=self.room_name,
                audio_only=True,  # Set to False if you want video composite
                file_outputs=[
                    lk_api.EncodedFileOutput(
                        file_type=lk_api.EncodedFileType.MP4,
                        filepath=self.file_path,
                    )
                ],
            )
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.start_room_composite_egress(room_composite)
                self.egress_id = egress_info.egress_id
                
                logger.info(f"✅ Started room composite Egress: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                
                return self.egress_id
                
        except Exception as e:
            logger.error(f"❌ Failed to start room composite Egress: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop room composite recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active room composite recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped room composite recording: {self.egress_id}")
                
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Room composite metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
                
        except Exception as e:
            logger.error(f"❌ Failed to stop room composite recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save room composite metadata to server database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,  # "room_composite"
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved room composite metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save room composite metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save room composite metadata: {e}")


class AudioMerger:
    """Merges user and agent audio files using ffmpeg"""
    
    def __init__(self, session_id: str, audio_storage_path: str = None):
        self.session_id = session_id
        # Get the audio storage path (resolve /out to actual directory)
        if audio_storage_path is None:
            self.audio_storage_path = os.path.join(os.path.dirname(__file__), "audio_storage")
        else:
            self.audio_storage_path = audio_storage_path
        
        # Ensure directory exists
        os.makedirs(self.audio_storage_path, exist_ok=True)
    
    def get_actual_file_path(self, egress_path: str) -> str:
        """Convert Egress container path (/out/...) to actual file path"""
        if egress_path.startswith("/out/"):
            filename = egress_path.replace("/out/", "")
            return os.path.join(self.audio_storage_path, filename)
        return egress_path
    
    async def merge_audio_files(self, user_file_path: str, agent_file_path: str) -> Optional[str]:
        """
        Merge user and agent audio files into a single seamless file
        Uses ffmpeg to mix both tracks together naturally (not side-by-side)
        This preserves the natural timing of the conversation without overlap
        """
        try:
            # Convert container paths to actual file paths
            user_file = self.get_actual_file_path(user_file_path)
            agent_file = self.get_actual_file_path(agent_file_path)
            
            # Check if files exist
            if not os.path.exists(user_file):
                logger.error(f"❌ User audio file not found: {user_file}")
                return None
            
            if not os.path.exists(agent_file):
                logger.error(f"❌ Agent audio file not found: {agent_file}")
                return None
            
            logger.info(f"🔊 Merging audio files:")
            logger.info(f"  User:  {user_file}")
            logger.info(f"  Agent: {agent_file}")
            
            # Generate output filename
            timestamp = int(time.time())
            output_filename = f"merged_{self.session_id}_{timestamp}.mp4"
            output_path = os.path.join(self.audio_storage_path, output_filename)
            
            # Use ffmpeg to merge audio files
            # Strategy: Mix both audio streams into a single mono/stereo output
            # This creates a natural conversation flow where both voices are heard together
            # The amix filter will blend the audio naturally without side-by-side stereo
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', user_file,      # Input 1: user audio
                '-i', agent_file,     # Input 2: agent audio
                '-filter_complex',    # Complex audio filter
                '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]',  # Mix both inputs naturally
                '-map', '[aout]',     # Map the mixed audio
                '-c:a', 'aac',        # Audio codec
                '-b:a', '192k',       # Audio bitrate
                '-y',                 # Overwrite output file if exists
                output_path
            ]
            
            logger.info(f"🎬 Running ffmpeg to merge audio with amix filter...")
            
            # Run ffmpeg command asynchronously
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                # Get file size
                file_size = os.path.getsize(output_path)
                file_size_mb = file_size / (1024 * 1024)
                
                logger.info(f"✅ Audio files merged successfully!")
                logger.info(f"📁 Output: {output_path}")
                logger.info(f"📊 Size: {file_size_mb:.2f}MB")
                
                return output_path
            else:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"❌ ffmpeg failed with return code {process.returncode}")
                logger.error(f"Error: {error_msg}")
                return None
                
        except FileNotFoundError:
            logger.error("❌ ffmpeg not found. Please install ffmpeg: brew install ffmpeg")
            return None
        except Exception as e:
            logger.error(f"❌ Failed to merge audio files: {e}", exc_info=True)
            return None
    
    async def save_merged_metadata_to_db(self, merged_file_path: str):
        """Save merged recording metadata to database"""
        try:
            file_size = os.path.getsize(merged_file_path)
            
            async with aiohttp.ClientSession() as session:
                payload = {
                    "file_path": merged_file_path,
                    "file_size": file_size,
                    "status": "merged",
                    "type": "merged_audio"
                }
                
                async with session.post(
                    f"{SERVER_URL}/sessions/{self.session_id}/recording",
                    json=payload,
                    headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved merged recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save merged metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save merged metadata: {e}")


def prewarm(proc):
    """Prewarm forked process (receives JobProcess, not JobContext)."""
    logger.info("🔥 Prewarming SpashtAI agent worker")
    logger.info("🤖 Using AUTOMATIC dispatch - agent will join all new rooms")

async def entrypoint(ctx: JobContext):
    """
    Enhanced entrypoint with transcript support
    Reference: https://docs.livekit.io/agents/integrations/realtime/nova-sonic/
    """
    
    # CRITICAL: Connect with AUDIO_ONLY subscription for voice
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for a real user to join before initializing the Bedrock session.
    # Without this the agent starts streaming to Nova Sonic in an empty room,
    # causing "Timed out waiting for input events" errors from AWS.
    participant = await ctx.wait_for_participant()
    
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Agent starting in room: {ctx.room.name}")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Participants: {len(ctx.room.remote_participants)}")
    
    # Extract or generate session ID
    # Priority:
    # 1) Room metadata (set during room creation by server)
    # 2) Dispatch/job metadata (backup)
    # 3) Fallback generated ID
    session_id = None

    # 1) Try room metadata first (most reliable for resume flows)
    room_meta: dict = {}
    try:
        if hasattr(ctx, 'room') and getattr(ctx.room, 'metadata', None):
            room_meta = json.loads(ctx.room.metadata)
            session_id = room_meta.get('sessionId')
            if session_id:
                logger.info(f"📦 Session ID loaded from room metadata: {session_id}")
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse room metadata: {e}")

    # 2) Try job metadata as backup
    if not session_id:
        try:
            if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata') and ctx.job.metadata:
                job_metadata = json.loads(ctx.job.metadata)
                session_id = job_metadata.get('sessionId')
                if session_id:
                    logger.info(f"📦 Session ID loaded from job metadata: {session_id}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    persistence_enabled = True
    if not session_id:
        # Safety fallback: never create synthetic persisted session IDs.
        # If metadata is missing, run voice flow but skip DB persistence to avoid duplicate sessions.
        persistence_enabled = False
        session_id = f"ephemeral_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
        logger.error(
            "❌ Missing sessionId in room/job metadata for room %s. "
            "Running in ephemeral mode (no DB persistence) to avoid duplicate sessions.",
            ctx.room.name,
        )
    
    logger.info(f"📋 Session ID: {session_id}")

    # Refuse to resume a session that is already finalized. A re-dispatch or
    # reconnect can hand us an ended session's ID via room metadata; starting a
    # full coaching session on it produces a phantom duplicate that has no live
    # audio and crashes on the 15s no-audio STT timeout. Exit gracefully.
    if persistence_enabled and await fetch_session_ended(session_id):
        logger.warning(
            "🛑 Session %s is already ended — refusing to resume a finalized session; "
            "shutting down this job to avoid a phantom duplicate.",
            session_id,
        )
        return

    history_messages = await fetch_session_history(session_id) if persistence_enabled else []
    resume_context = build_resume_context(history_messages)
    if history_messages:
        logger.info("📚 Loaded %d prior messages for resumed context", len(history_messages))
    else:
        logger.info("📚 No prior messages found for session context")
    conversation_logger = ConversationLogger(session_id) if persistence_enabled else None
    if conversation_logger:
        logger.info("💬 Conversation logger initialized")
    else:
        logger.warning("💬 Conversation logging disabled (ephemeral mode)")
    
    # Initialize advanced metrics collector (includes basic metrics via MetricsCollector)
    advanced_metrics = None
    if ADVANCED_ANALYTICS_AVAILABLE:
        try:
            advanced_metrics = AdvancedMetricsCollector(session_id)
            advanced_metrics.start_session()
            logger.info("🧠 Advanced analytics initialized (spaCy + Praat + Gentle)")
            logger.info("📊 Basic metrics tracking included (WPM, turns, response times)")
        except Exception as e:
            logger.warning(f"⚠️ Failed to initialize advanced analytics: {e}")
            advanced_metrics = None
    
    # Note: Audio is captured via Egress recorders (user/agent/room composite)
    # We use the recorded MP4 files for Gentle/Praat analysis at session end
    # No need for real-time frame capture
    
    # `participant` comes from ctx.wait_for_participant() above
    user_participant = participant
    logger.info(f"👤 User participant joined: {user_participant.identity}")
    
    # Initialize THREE Egress recorders running in parallel:
    # 1. ParticipantEgress for user audio (MP4)
    # 2. TrackEgress for agent audio (OGG)
    # 3. RoomCompositeEgress for combined room recording (MP4)
    user_identity = user_participant.identity if user_participant else None
    user_recorder = EgressRecorder(ctx.room.name, session_id, user_identity, participant_type="user")
    
    # Agent recorder - will use TrackEgress to record specific audio track
    agent_recorder = TrackEgressRecorder(ctx.room.name, session_id, None, participant_type="agent")
    
    # Room composite recorder - records entire room (all participants combined)
    room_recorder = RoomCompositeEgressRecorder(ctx.room.name, session_id, participant_type="room_composite")
    
    logger.info("⏳ Triple recording will start after session initialization (user + agent + room composite)")
    
    # ── Voice backend selection (admin-configurable) ──
    # Set by the server in apps/server/src/routes/livekit.ts. Defaults to
    # Nova Sonic if the field is missing (e.g. older client / pre-feature room).
    voice_cfg = VoiceBackendConfig.from_room_meta(room_meta)
    # Single source of truth for per-path behavior. Every backend-specific branch
    # below reads from `profile` instead of inlining `if backend == ...`, so the
    # three voice paths stay isolated (see backend_profiles.py).
    profile = profile_for(voice_cfg)
    logger.info(
        "🎚️  Voice backend selected: %s (path=%s, voice=%s, llm=%s, turn_detection=%s, stt_mode=%s)",
        voice_cfg.backend, profile.path, voice_cfg.voice_name, voice_cfg.pipeline_llm,
        voice_cfg.turn_detection, profile.stt_mode.value,
    )

    try:
        # Set agent metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                json.dumps({
                    "role": "agent",
                    "type": "voice_assistant",
                    "model": metadata_label(voice_cfg),
                    "backend": voice_cfg.backend,
                })
            )
            logger.info("✅ Agent metadata set")
        except Exception as e:
            logger.warning("⚠️ Failed to set metadata: %s", e)
        
        # Region kept for backward-compat downstream usage; the backend factory
        # also reads it directly from env when building Nova Sonic.
        _ = region  # silence unused warning if pipeline backend is active
        
        # Track actual AWS usage metrics for billing
        # Note: Token metrics will be estimated from conversation text since
        # Nova Sonic RealtimeModel emits metrics internally but doesn't expose a public event API
        usage_metrics = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "speech_input_tokens": 0,
            "speech_output_tokens": 0,
            "text_input_tokens": 0,
            "text_output_tokens": 0,
        }
        
        # Build personalized agent instructions from room metadata
        user_name = room_meta.get('userName', '').strip() or None
        focus_area = room_meta.get('focusArea', '').strip() or None
        focus_context = room_meta.get('focusContext', '').strip() or None
        session_name = room_meta.get('sessionName', '').strip() or None

        logger.info(f"👤 User name: {user_name or '(unknown)'}, focus: {focus_area or 'general'}, context: {focus_context or '(none)'}")

        TOOL_GROUNDING = (
            "VOICE OUTPUT RULES:\n"
            "• Never output <thinking> tags, XML, markdown, or internal reasoning.\n"
            "• Never say the word 'thinking' or describe your planning process aloud.\n"
            "• Plan silently — only speak words the user should hear.\n"
            "• No bullet lists or markdown in spoken replies.\n\n"
            "LIVE METRICS (critical path — do not block on tools):\n"
            "• The user's app shows real-time WPM, fillers, hedges, and turn cards.\n"
            "• Fresh metrics are injected into your context after each user turn — use those.\n"
            "• Respond immediately with warm, qualitative coaching ('your pace felt steady', "
            "'I noticed a few fillers when you got excited').\n"
            "• Do NOT call get_live_pacing or get_speech_metrics before speaking — tools are "
            "only for when the user explicitly asks for a precise number.\n"
            "• Never invent WPM or filler counts. If you lack data, coach qualitatively "
            "or say 'keep going — I'm tracking your pace on screen'.\n"
            "• Acknowledgments like 'okay' or 'yeah' are tracked separately — not strict fillers.\n"
            "• 'Like' in 'I like cricket' is NOT a filler; discourse 'like' is counted.\n\n"
            "ANTI-HALLUCINATION (critical):\n"
            "• NEVER quote, paraphrase, or attribute speech the user did not say in this session.\n"
            "• NEVER fabricate a 'previous session', 'last time', or past conversation. Only "
            "reference prior sessions if real data is explicitly provided in your context "
            "(USER DATA / LAST PRACTICE SESSION). If no such data is provided, you have NO "
            "record of past sessions — say so honestly and do not invent recaps or quotes.\n"
            "• If the user asks you to quote their earlier words and you have no provided "
            "transcript of them, say you don't have that on record rather than guessing.\n"
            "• NEVER give PREP or signposting feedback unless the user's last turn was a "
            "substantial answer (roughly 25+ words).\n"
            "• If they have not delivered a full exercise answer, ask them to speak — "
            "do not invent their content.\n"
            "• Past skill scores from USER DATA are real; invented user quotes are not."
        )

        default_persona = (
            "You are a voice AI coach for SpashtAI, a platform that helps people become better communicators. "
            "Your interface with users will be voice. Use short and concise responses, "
            "and avoid unpronounceable punctuation. Be warm, encouraging, and professional."
        )
        custom_persona = await fetch_agent_prompt("elevate_coach_persona")
        base_instructions = f"{custom_persona or default_persona}\n\n{TOOL_GROUNDING}"

        # Personalization: use the user's name naturally
        if user_name:
            base_instructions += (
                f"\n\nThe user's name is {user_name}. "
                f"Greet them by name at the start (e.g. 'Hello {user_name}, welcome to SpashtAI!'). "
                "Use their name naturally once in a while during the conversation — "
                "like a real coach would — but don't overdo it. "
                "For example, use it when giving praise, asking a reflective question, "
                "or wrapping up a topic."
            )

        # Fetch rich coaching context from server API
        coaching_context = None
        _debug_log(f"ENTRYPOINT coaching context check: session_id={session_id}, focus_area={focus_area}, persistence={persistence_enabled}")
        _debug_log(f"Room metadata keys: {list(room_meta.keys())}, values: {room_meta}")
        logger.info(f"🔍 Coaching context check: session_id={session_id}, focus_area={focus_area}")
        if focus_area and session_id and not session_id.startswith("ephemeral_"):
            logger.info(f"📡 Fetching coaching context for session={session_id}, focus={focus_area}")
            _debug_log(f"CALLING fetch_coaching_context...")
            coaching_context = await fetch_coaching_context(session_id, focus_area)
            if coaching_context:
                logger.info(f"✅ Coaching context received: {len(coaching_context.get('skillSummaries', {}))} skills")
                _debug_log(f"Coaching context keys: {list(coaching_context.keys())}")
            else:
                logger.warning("❌ Coaching context fetch returned None")
                _debug_log("Coaching context returned None!")
        else:
            reason = []
            if not focus_area: reason.append("no focus_area")
            if not session_id: reason.append("no session_id")
            if session_id and session_id.startswith("ephemeral_"): reason.append("ephemeral session")
            logger.warning(f"⏭️ Skipping coaching context: {', '.join(reason)}")
            _debug_log(f"SKIPPED coaching context: {', '.join(reason)}")

        # Session scope: adapt based on how the user arrived
        exercise_instructions = ""
        if focus_area:
            custom_exercise = await fetch_agent_prompt(f"elevate_exercise_{focus_area}")
            if custom_exercise:
                exercise_instructions = custom_exercise
            else:
                exercise_instructions = get_exercise_instructions(focus_area, focus_context, coaching_context)
            _debug_log(f"Exercise instructions length: {len(exercise_instructions)}, has coaching data: {'USER DATA' in exercise_instructions}")

        # Auto-select coach patience from the session type — no manual UI control.
        # Monologue/long-answer exercises need patient endpointing so natural
        # mid-sentence pauses don't trigger the coach. Conversational sessions
        # use a balanced wait for snappy back-and-forth.
        is_monologue_session = bool(
            focus_area in MONOLOGUE_FOCUS_AREAS or exercise_instructions
        )
        auto_turn_detection = "LOW" if is_monologue_session else "MEDIUM"
        voice_cfg.turn_detection = auto_turn_detection
        logger.info(
            "🎚️ Auto-selected coach patience: %s (%s session, focus=%s)",
            auto_turn_detection,
            "monologue" if is_monologue_session else "conversational",
            focus_area or "none",
        )

        if exercise_instructions:
            base_instructions += f"\n\n{exercise_instructions}"
        elif focus_context:
            base_instructions += (
                f"\n\nThis session was started from a Replay analysis recommendation. "
                f"The specific area to work on is: \"{focus_context}\". "
                "Focus the session on this topic. Your greeting should acknowledge "
                "what they're here to practice (e.g. 'Let's work on your pacing today' "
                "rather than a generic welcome). Ask targeted questions and provide "
                "feedback specific to this skill area."
            )
        elif focus_area:
            base_instructions += (
                f"\n\nThe user chose \"{focus_area}\" as their focus area. "
                "Tailor your coaching, questions, and feedback to this area. "
                "Mention it in your greeting so they know you're aligned."
            )
        else:
            base_instructions += (
                "\n\nThis is a general practice session with no specific focus area. "
                "Ask the user what they'd like to work on — it could be interview prep, "
                "pitch practice, presentation skills, or anything communication-related. "
                "Be open and let them guide the direction."
            )

        combined_instructions = (
            f"{base_instructions}\n\n{resume_context}"
            if resume_context
            else base_instructions
        )

        focus_score: float | None = None
        if coaching_context and focus_area:
            focus_skill = coaching_context.get("skillSummaries", {}).get(focus_area)
            if focus_skill and focus_skill.get("current") is not None:
                focus_score = float(focus_skill["current"])

        if profile.is_pipeline:
            combined_instructions += (
                "\n\nPIPELINE MODE:\n"
                "• Your opening greeting is spoken automatically via TTS at session start.\n"
                "• Do NOT greet again or repeat the welcome — wait for the user to speak.\n"
                "• After asking a PREP or long-form question, stay silent until they finish. "
                "Silence is NOT an answer — never invent feedback during quiet.\n"
            )

        # ── Live pacing tracker (real WPM grounded in audio events) ──
        # Populated via session.on(...) handlers below. The CoachingAgent
        # exposes a `get_live_pacing` tool that the LLM can call to retrieve
        # measured numbers — this is what makes "you're speaking at 187 WPM"
        # grounded instead of hallucinated.
        pacing_tracker = LivePacingTracker()

        # Monologue guard is nova-sonic-only. Nova Sonic is speech-to-speech with
        # aggressive (~2s) streaming endpointing that can emit premature backchannels
        # mid-monologue — the guard cuts those. The pipeline backends are turn-based
        # with patient Silero endpointing (2–4s) and no preemptive generation, so the
        # coach can't interject mid-answer; there the guard is redundant and can
        # falsely cut short coach replies. Anti-hallucination on short turns is handled
        # separately by the [TURN GUARD] instruction, which is not gated.
        monologue_guard = MonologueGuard(
            enabled=bool(
                profile.monologue_guard_supported
                and (focus_area in MONOLOGUE_FOCUS_AREAS or exercise_instructions)
            ),
        )
        if monologue_guard.enabled:
            logger.info("🎙️ Monologue guard enabled (nova-sonic long-answer exercises)")

        agent = CoachingAgent(
            instructions=combined_instructions,
            pacing_tracker=pacing_tracker,
            advanced_metrics=advanced_metrics,
            # Lazy room getter — ctx.room is already valid at this point but
            # we wrap it so the closure stays cheap and the room reference
            # always reflects the live session.
            room_getter=lambda: ctx.room,
            user_name=user_name,
            focus_area=focus_area,
            session_name=session_name,
            voice_backend=voice_cfg.backend,
            focus_score=focus_score,
            monologue_guard=monologue_guard,
            is_resume=bool(history_messages),
        )
        logger.info("✅ CoachingAgent created (with get_live_pacing tool + live-sync push)")
        
        # Create AgentSession via the voice-backend factory.
        # • nova-sonic        → AWS Bedrock RealtimeModel (legacy default)
        # • pipeline-premium  → faster-whisper + Ollama + Kokoro
        # • pipeline-bedrock  → Whisper/Transcribe + Nova Lite + Kokoro/Polly
        # • unknown / pipeline servers down → falls back to nova-sonic.
        session = await build_session(voice_cfg)
        logger.info("✅ AgentSession created with transcript support")

        async def _suppress_premature_coach_speech(assistant_text: str) -> None:
            try:
                await session.interrupt(force=True)
                logger.info(
                    "🔇 Suppressed premature coach backchannel (%d chars): %s",
                    len(assistant_text),
                    assistant_text[:80],
                )
            except Exception as exc:
                logger.debug("monologue interrupt failed: %s", exc)

        _user_metrics_debounce_task: asyncio.Task | None = None
        USER_METRICS_DEBOUNCE_SEC = 2.0

        def _schedule_pending_user_metrics() -> None:
            nonlocal _user_metrics_debounce_task
            if not advanced_metrics:
                return

            async def _publish_after_quiet() -> None:
                await asyncio.sleep(USER_METRICS_DEBOUNCE_SEC)
                try:
                    advanced_metrics.publish_pending_user_utterance_metrics()
                except Exception as e:
                    logger.debug("pending user metrics publish failed: %s", e)

            if _user_metrics_debounce_task and not _user_metrics_debounce_task.done():
                _user_metrics_debounce_task.cancel()
            _user_metrics_debounce_task = asyncio.create_task(_publish_after_quiet())

        # Per-stage latency instrumentation: LiveKit emits one MetricsCollectedEvent
        # per pipeline stage (STT / EOU / LLM / TTS). This was previously never
        # subscribed, so TTFT/TTFB were silently 0. The collector logs each stage
        # and stitches them into a per-turn user-perceived latency line.
        @session.on("metrics_collected")
        def _on_metrics_collected(ev):  # noqa: ANN001
            if advanced_metrics:
                try:
                    advanced_metrics.on_metrics_collected(ev)
                except Exception as e:
                    logger.debug(f"metrics_collected hook failed: {e}")

        # Hook live-pacing measurement into VAD + transcript signals.
        @session.on("user_state_changed")
        def _on_user_state(ev):  # noqa: ANN001
            try:
                new_state = getattr(ev, "new_state", "") or ""
                pacing_tracker.on_user_state_changed(new_state)
                if new_state != "speaking":
                    _schedule_pending_user_metrics()
            except Exception as e:
                logger.debug(f"pacing user_state hook failed: {e}")

        # AWS Transcribe interims contain only the CURRENT segment, not the whole
        # turn. The turn stitcher's pending text isn't populated until turn end
        # (conversation_item_added), so we accumulate finalized segments here to
        # keep the live bubble growing instead of snapping back to the last
        # segment between pauses. Reset per turn (keyed on the turn index).
        _live_partial_state: dict = {"index": None, "finals": []}

        def _current_user_turn_index() -> int:
            if advanced_metrics:
                return advanced_metrics.basic_collector.current_user_turn_index()
            return 1

        def _reset_live_partial_if_new_turn(turn_index: int) -> None:
            if _live_partial_state["index"] != turn_index:
                _live_partial_state["index"] = turn_index
                _live_partial_state["finals"] = []

        def _publish_live_user_partial(interim: str) -> None:
            """Stream the user's in-progress speech to the UI (word-by-word display)."""
            try:
                turn_index = _current_user_turn_index()
                _reset_live_partial_if_new_turn(turn_index)
                prefix = " ".join(_live_partial_state["finals"]).strip()
                interim = (interim or "").strip()
                live_text = f"{prefix} {interim}".strip()
                if not live_text:
                    return
                payload = {
                    "type": "user",
                    "text": live_text,
                    "final": False,
                    "id": f"user_turn_{turn_index}",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                }
                asyncio.create_task(ctx.room.local_participant.publish_data(
                    json.dumps(payload).encode(),
                    topic="lk.conversation",
                ))
            except Exception as pub_err:
                logger.debug("live user partial publish failed: %s", pub_err)

        @session.on("user_input_transcribed")
        def _on_user_transcribed(ev):  # noqa: ANN001
            try:
                transcript = getattr(ev, "transcript", "") or ""
                is_final = bool(getattr(ev, "is_final", False))
                pacing_tracker.on_user_transcript(transcript, is_final)
                text = transcript.strip()
                if not text:
                    return
                # Live-partial bubble is a pipeline-path feature. nova-sonic (S2S)
                # surfaces the user transcript via conversation_item_added instead
                # (publish_user_fragments), so running this too would double-publish.
                # Works for both STT modes: streaming (Transcribe interims grow the
                # bubble) and batch (Whisper finalizes per VAD segment).
                if not profile.is_pipeline:
                    return
                if is_final:
                    # Fold the completed segment into the running prefix so the
                    # next segment's interims append to it (no snap-back).
                    _reset_live_partial_if_new_turn(_current_user_turn_index())
                    _live_partial_state["finals"].append(text)
                    _publish_live_user_partial("")
                else:
                    _publish_live_user_partial(text)
            except Exception as e:
                logger.debug(f"pacing transcript hook failed: {e}")
        
        # User-transcript publishing is backend-specific:
        #   • pipeline-bedrock / pipeline-premium stream live partials + a stitched
        #     commit via the user_turn_N path (_publish_live_user_partial +
        #     _publish_user_turn_metrics). Publishing raw STT fragments here too would
        #     create duplicate bubbles (a different id, user_<ts>).
        #   • nova-sonic is speech-to-speech and does NOT use that path, so it still
        #     needs on_conversation_item_added to surface the user's transcript.
        # DB logging below is unaffected (it runs outside this publish guard).
        publish_user_fragments = profile.publish_user_fragments

        # Register event handlers for transcripts
        @session.on("conversation_item_added")
        def on_conversation_item_added(item):
            """Handle conversation items from Nova Sonic"""
            try:
                logger.info(f"🎯 Conversation item: {type(item).__name__}")
                
                # Extract role and content
                role = "unknown"
                content = ""
                
                # Handle nested item structure
                if hasattr(item, 'item'):
                    msg = item.item
                    role = getattr(msg, 'role', 'unknown')
                    content_attr = getattr(msg, 'content', [])
                elif hasattr(item, 'role'):
                    role = getattr(item, 'role', 'unknown')
                    content_attr = getattr(item, 'content', [])
                else:
                    logger.debug(f"⏭️ Unknown item structure: {item}")
                    return
                
                # Extract text from content (Nova Sonic only sends text, not audio frames)
                if isinstance(content_attr, list):
                    content = ' '.join(str(p).strip() for p in content_attr if str(p).strip())
                elif isinstance(content_attr, str):
                    content = content_attr.strip()
                else:
                    content = str(content_attr).strip()

                if role == "assistant":
                    raw_content = content
                    content = strip_thinking_blocks(content)
                    if is_thinking_only(raw_content):
                        asyncio.create_task(_suppress_premature_coach_speech(raw_content))
                        logger.debug("⏭️ Suppressed thinking-only coach utterance")
                        return

                if role == "user" and is_likely_echo(content, agent._assistant_speech_history):
                    logger.warning("🔇 Dropping likely echo user transcript: %r", content[:120])
                    return

                # Skip empty/invalid content
                if not content or len(content) < 3:
                    logger.debug(f"⏭️ Skipping empty content")
                    return

                if role == "assistant" and monologue_guard.should_suppress_assistant(content):
                    asyncio.create_task(_suppress_premature_coach_speech(content))
                    return

                if role == "assistant":
                    record_assistant_speech(agent._assistant_speech_history, content)
                    if len(content) > 100:
                        monologue_guard.mark_answer_complete()
                    if agent._last_greeting_text and content.strip() == agent._last_greeting_text.strip():
                        logger.debug("⏭️ Skipping duplicate greeting publish")
                        # Still ingest metrics below; only skip lk.conversation duplicate.
                        publish_this_message = False
                    else:
                        publish_this_message = True
                elif role == "user":
                    publish_this_message = publish_user_fragments
                else:
                    publish_this_message = True
                
                logger.info(f"📝 {role}: {content[:100]}...")
                
                if publish_this_message:
                    message_data = {
                        "type": role,
                        "text": content,
                        "final": True,
                        "id": getattr(item, 'id', f"{role}_{int(datetime.now().timestamp() * 1000)}"),
                        "timestamp": int(datetime.now().timestamp() * 1000)
                    }
                    
                    asyncio.create_task(ctx.room.local_participant.publish_data(
                        json.dumps(message_data).encode(),
                        topic="lk.conversation"
                    ))
                
                # Log to database
                if conversation_logger:
                    asyncio.create_task(conversation_logger.log_message(role, content))
                
                # Feed to advanced metrics collector (which includes basic metrics)
                if advanced_metrics:
                    try:
                        # This automatically updates both basic metrics and advanced analytics
                        advanced_metrics.ingest_conversation_fragment(role, content)
                    except Exception as analytics_error:
                        logger.debug(f"⚠️ Analytics tracking error: {analytics_error}")

                # Also feed user transcripts into LivePacingTracker. The
                # `user_input_transcribed` event is unreliable in pipeline
                # mode (Whisper + Ollama + Kokoro), so we use this event as
                # the canonical source. The tracker dedups against doubles.
                if role == 'user':
                    try:
                        monologue_guard.on_user_fragment(content)
                        pacing_tracker.on_user_transcript(content, is_final=True)
                    except Exception as pace_err:
                        logger.debug(f"pacing fallback hook failed: {pace_err}")
                    _schedule_pending_user_metrics()
                
            except Exception as e:
                logger.warning("⚠️ Error in conversation_item_added: %s", e)
        
        logger.info("✅ Event handlers registered")

        _last_turn_detection_apply = 0.0
        TURN_DETECTION_MIN_INTERVAL_SEC = 45.0

        async def _apply_turn_detection_from_client(new_level: str) -> None:
            nonlocal _last_turn_detection_apply
            now = asyncio.get_event_loop().time()
            if now - _last_turn_detection_apply < TURN_DETECTION_MIN_INTERVAL_SEC:
                logger.warning(
                    "Ignoring turn_detection=%s — recycled %.0fs ago (min %.0fs)",
                    new_level,
                    now - _last_turn_detection_apply,
                    TURN_DETECTION_MIN_INTERVAL_SEC,
                )
                try:
                    await ctx.room.local_participant.publish_data(
                        json.dumps({
                            "type": "turn_detection_ack",
                            "value": voice_cfg.turn_detection,
                            "applied": False,
                            "backend": voice_cfg.backend,
                            "reason": "throttled",
                        }).encode(),
                        topic="lk.settings",
                    )
                except Exception:
                    pass
                return

            applied = await apply_turn_detection_update(session, voice_cfg, new_level)
            if applied:
                _last_turn_detection_apply = now
            try:
                await ctx.room.local_participant.publish_data(
                    json.dumps({
                        "type": "turn_detection_ack",
                        "value": voice_cfg.turn_detection,
                        "applied": applied,
                        "backend": voice_cfg.backend,
                    }).encode(),
                    topic="lk.settings",
                )
            except Exception as ack_err:
                logger.debug("turn_detection ack failed: %s", ack_err)

        @ctx.room.on("data_received")
        def on_settings_data(packet):  # noqa: ANN001
            if getattr(packet, "topic", None) != "lk.settings":
                return
            try:
                payload = json.loads(packet.data.decode())
            except Exception:
                return
            msg_type = payload.get("type")
            if msg_type == "turn_detection":
                asyncio.create_task(_apply_turn_detection_from_client(payload.get("value", "MEDIUM")))

        # Send ready status to frontend
        await asyncio.sleep(0.5)  # Brief delay for connection stability
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "ready",
                "agent_model": metadata_label(voice_cfg),
                "agent_backend": voice_cfg.backend,
                "timestamp": datetime.now().isoformat()
            }).encode(),
            topic="lk.control"
        )
        logger.info("✅ Sent ready status")
        logger.info("�️ Room recording via Egress will capture all audio automatically")
        
        session_closed = asyncio.Event()
        
        @session.on("close")
        def on_session_close(event):
            logger.info(f"🔚 Session close event received, error: {event.error if hasattr(event, 'error') else None}")
            session_closed.set()
        
        # ── Live metrics publisher ────────────────────────────────────
        # The frontend's "Show Metrics" toggle reveals a card that listens to
        # the `lk.metrics` data-channel topic. Push a fresh snapshot every
        # ~12s so the user can self-correct mid-session (slow down, catch
        # filler-word spikes, etc.) without waiting for the post-session
        # report. Grounded in the LivePacingTracker we built for #1/#2.
        if advanced_metrics:
            try:
                advanced_metrics.attach_pacing_tracker(pacing_tracker)
                logger.info("🔗 Pacing tracker attached to advanced_metrics for live publish")
            except Exception as e:
                logger.warning(f"⚠️ Could not attach pacing tracker: {e}")

            # Buffer committed user-turn metrics keyed by user turn index (1-based)
            # so we can persist them as SessionTurn rows at session end (replay).
            committed_user_turns: dict[int, dict] = {}

            async def _publish_user_turn_metrics(
                stitched_text: str, turn_metrics_snapshot, turn_index: int = 0,
                is_commit: bool = False,
            ) -> None:
                try:
                    ts = int(datetime.now().timestamp() * 1000)
                    if is_commit and turn_index > 0:
                        try:
                            committed_user_turns[turn_index] = {
                                "text": stitched_text,
                                "metrics": turn_metrics_snapshot.to_dict(),
                            }
                        except Exception:
                            pass
                    payload = {
                        "type": "turn_metrics",
                        "text": stitched_text,
                        "turnMetrics": turn_metrics_snapshot.to_dict(),
                        "turnIndex": turn_index,
                        "timestamp": ts,
                    }
                    await ctx.room.local_participant.publish_data(
                        json.dumps(payload).encode(),
                        topic="lk.conversation",
                    )
                    # Only publish the user bubble on a real turn commit. The
                    # live interim partials already drive the bubble; republishing
                    # the (shorter) committed text mid-turn makes it jump/flicker.
                    if is_commit and stitched_text.strip() and turn_index > 0:
                        user_payload = {
                            "type": "user",
                            "text": stitched_text.strip(),
                            "final": True,
                            "id": f"user_turn_{turn_index}",
                            "timestamp": ts,
                            "stitched": True,
                        }
                        await ctx.room.local_participant.publish_data(
                            json.dumps(user_payload).encode(),
                            topic="lk.conversation",
                        )
                except Exception as pub_err:
                    logger.warning("⚠️ Failed to publish turn metrics: %s", pub_err)

            def _schedule_user_turn_metrics(
                text: str, metrics_snapshot, turn_index: int = 0,
                is_commit: bool = False,
            ) -> None:
                asyncio.create_task(
                    _publish_user_turn_metrics(text, metrics_snapshot, turn_index, is_commit)
                )

            try:
                bc = advanced_metrics.basic_collector
                bc.set_utterance_peeker(pacing_tracker.peek_last_utterance)
                bc.set_session_totals_peeker(pacing_tracker.get_session_totals)
                bc.set_user_turn_metrics_callback(_schedule_user_turn_metrics)
                bc.set_turn_committed_callback(advanced_metrics.record_committed_turn)
                logger.info("🔗 Turn stitcher wired (utterance peeker + per-turn metrics publish)")
            except Exception as e:
                logger.warning(f"⚠️ Could not wire turn metrics callbacks: {e}")

        live_metrics_task: asyncio.Task | None = None
        if advanced_metrics:
            async def _live_metrics_publisher():
                # Initial delay so the first emission has at least one user turn.
                await asyncio.sleep(8)
                interval = 12  # seconds — "minute delay" tolerance per UX brief
                tick = 0
                while not session_closed.is_set():
                    tick += 1
                    try:
                        await advanced_metrics.publish_metrics_update(ctx.room)
                        logger.info(f"📡 live-metrics tick #{tick} published to lk.metrics topic")
                    except Exception as pub_err:
                        logger.warning(f"⚠️ live-metrics tick #{tick} failed: {pub_err}")
                    try:
                        await asyncio.wait_for(session_closed.wait(), timeout=interval)
                    except asyncio.TimeoutError:
                        pass
                logger.info("🛑 Live metrics publisher stopped (session closed)")

            live_metrics_task = asyncio.create_task(_live_metrics_publisher())
            logger.info("📡 Live metrics publisher scheduled (every 12s)")

        # Start session (proven pattern - this handles everything)
        logger.info("🎯 Starting AgentSession...")
        session_task = asyncio.create_task(session.start(room=ctx.room, agent=agent))

        async def _greeting_watchdog() -> None:
            """Fallback if on_enter greeting was cancelled or never ran."""
            for _ in range(24):
                if agent._greeting_sent:
                    return
                await asyncio.sleep(0.5)
            if agent._greeting_sent:
                return
            logger.warning("⚠️ Opening greeting not sent from on_enter — entrypoint fallback")
            try:
                await agent._send_opening_greeting()
            except Exception as wd_err:
                logger.error("Greeting watchdog failed: %s", wd_err, exc_info=True)

        asyncio.create_task(_greeting_watchdog())
        
        # Egress (server-side recording) needs a running livekit-egress service.
        # It's off by default in dev (no egress server → 503s) and on in production.
        # Override with EGRESS_ENABLED=true/false.
        egress_enabled = os.getenv(
            "EGRESS_ENABLED",
            "true" if os.getenv("ENVIRONMENT", "development") == "production" else "false",
        ).lower() in ("1", "true", "yes")

        agent_track_id = None
        if not egress_enabled:
            logger.info(
                "🎙️ Egress recording disabled (set EGRESS_ENABLED=true to enable). "
                "Session continues; use the in-UI recorder for client-side capture."
            )
        else:
            # Wait for agent to publish audio tracks before starting recording
            logger.info("⏳ Waiting for agent audio tracks to be published...")

            # Wait up to 10 seconds for agent tracks
            for i in range(20):  # 20 attempts * 0.5s = 10 seconds max
                await asyncio.sleep(0.5)
                local_participant = ctx.room.local_participant
                if local_participant and local_participant.track_publications:
                    for track_pub in local_participant.track_publications.values():
                        if track_pub.kind == rtc.TrackKind.KIND_AUDIO and track_pub.track:
                            agent_track_id = track_pub.sid
                            logger.info(f"✅ Agent audio track found: {agent_track_id}")
                            break
                if agent_track_id:
                    break

            if not agent_track_id:
                logger.warning("⚠️ Agent audio tracks not detected after 10s, will only record user audio")

            try:
                # Update user participant if needed
                if not user_recorder.participant_identity and ctx.room.remote_participants:
                    user_participant = list(ctx.room.remote_participants.values())[0]
                    user_recorder.participant_identity = user_participant.identity
                    logger.info(f"👤 Updated user participant: {user_participant.identity}")

                # Start all three recordings in parallel
                # 1. User recording (ParticipantEgress)
                user_recording_id = await user_recorder.start_recording()
                if user_recording_id:
                    logger.info(f"🎬 User audio recording started: {user_recording_id}")

                # 2. Agent recording if track ID found (TrackEgress)
                agent_recording_id = None
                if agent_track_id:
                    agent_recorder.track_id = agent_track_id
                    logger.info(f"🎙️ Starting agent track recording for: {agent_track_id}")
                    agent_recording_id = await agent_recorder.start_recording()
                    if agent_recording_id:
                        logger.info(f"🎬 Agent audio recording started: {agent_recording_id}")
                else:
                    logger.warning("⚠️ Skipping agent recording - no audio tracks published")

                # 3. Room composite recording (combined audio from all participants)
                room_recording_id = await room_recorder.start_recording()
                if room_recording_id:
                    logger.info(f"🎬 Room composite recording started: {room_recording_id}")

                if not user_recording_id and not agent_recording_id and not room_recording_id:
                    logger.warning("⚠️ Failed to start any recordings - continuing without recording")
            except Exception as e:
                logger.warning(f"⚠️ Recording start failed: {e}")
        
        # Wait for the session to ACTUALLY close (not just start)
        await session_closed.wait()
        logger.info("🎉 Session completed - waiting for task cleanup...")

        # Cancel the live-metrics publisher so it doesn't try to publish into
        # a closed room and surface a noisy "Failed to publish data" error.
        if live_metrics_task and not live_metrics_task.done():
            live_metrics_task.cancel()
            try:
                await live_metrics_task
            except (asyncio.CancelledError, Exception):
                pass

        # Give the task a moment to cleanup
        try:
            await asyncio.wait_for(session_task, timeout=2.0)
        except asyncio.TimeoutError:
            logger.warning("⚠️ Session task timeout during cleanup")
        
        logger.info("✅ Session fully closed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e, exc_info=True)
        raise
    finally:
        # Stop ALL THREE recordings and save metadata
        user_file_path = None
        agent_file_path = None
        room_file_path = None
        
        try:
            # Stop user recording
            user_metadata = await user_recorder.stop_recording()
            if user_metadata:
                if persistence_enabled:
                    await user_recorder.save_metadata_to_db(user_metadata)
                user_file_path = user_metadata.get("file_path")
                logger.info("✅ User recording stopped and metadata saved")
            # If stop failed, try to use the file path that was set during start
            elif user_recorder.file_path:
                user_file_path = user_recorder.file_path
                logger.info("ℹ️ User recording already completed, using file path from start")
            
            # Stop agent recording (only if it was started)
            if agent_recorder.recording_id:
                agent_metadata = await agent_recorder.stop_recording()
                if agent_metadata:
                    if persistence_enabled:
                        await agent_recorder.save_metadata_to_db(agent_metadata)
                    agent_file_path = agent_metadata.get("file_path")
                    logger.info("✅ Agent recording stopped and metadata saved")
                # If stop failed, try to use the file path that was set during start
                elif agent_recorder.file_path:
                    agent_file_path = agent_recorder.file_path
                    logger.info("ℹ️ Agent recording already completed, using file path from start")
            else:
                logger.info("ℹ️ Agent recording was not started, nothing to stop")
            
            # Stop room composite recording
            if room_recorder.egress_id:
                room_metadata = await room_recorder.stop_recording()
                if room_metadata:
                    if persistence_enabled:
                        await room_recorder.save_metadata_to_db(room_metadata)
                    room_file_path = room_metadata.get("file_path")
                    logger.info("✅ Room composite recording stopped and metadata saved")
                # If stop failed, try to use the file path that was set during start
                elif room_recorder.file_path:
                    room_file_path = room_recorder.file_path
                    logger.info("ℹ️ Room composite recording already completed, using file path from start")
            else:
                logger.info("ℹ️ Room composite recording was not started, nothing to stop")
                
        except Exception as e:
            logger.error(f"❌ Error stopping recordings: {e}")
            # Even if stop fails, try to use the paths set during start
            if not user_file_path and user_recorder.file_path:
                user_file_path = user_recorder.file_path
            if not agent_file_path and agent_recorder.file_path:
                agent_file_path = agent_recorder.file_path
            if not room_file_path and room_recorder.file_path:
                room_file_path = room_recorder.file_path
        
        # Note: We now have 3 separate recordings:
        # 1. User audio (ParticipantEgress) - isolated user voice
        # 2. Agent audio (TrackEgress) - isolated agent voice
        # 3. Room composite (RoomCompositeEgress) - combined audio of all participants
        # The composite is useful for playback, while separate files are better for analysis
        
        logger.info(f"📁 Audio files saved separately:")
        if user_file_path:
            logger.info(f"  User: {user_file_path}")
        if agent_file_path:
            logger.info(f"  Agent: {agent_file_path}")
        if room_file_path:
            logger.info(f"  Room Composite: {room_file_path}")
        
        # Process advanced analytics at session end
        if advanced_metrics and (user_file_path or advanced_metrics.user_transcript):
            try:
                logger.info("🔬 Starting advanced analytics processing...")
                
                # Call finalize_session() which automatically:
                # 1. Finalizes basic metrics (WPM, turns, filler words, response times)
                # 2. Analyzes audio delivery (if audio file exists)
                # 3. Analyzes content with spaCy
                # 4. Generates performance insights
                logger.info("🎯 Finalizing comprehensive session analysis...")
                
                local_user_audio_path = None
                if user_file_path:
                    base_name = os.path.basename(user_file_path)
                    local_user_audio_path = os.path.join(
                        os.path.dirname(__file__), "audio_storage", base_name
                    )
                    if not os.path.exists(local_user_audio_path):
                        local_user_audio_path = user_file_path
                    logger.info(f"📁 Using user audio file for delivery analysis: {local_user_audio_path}")
                
                # Plumb the audio-grounded user speaking duration into the
                # basic metrics collector so its WPM uses real time instead of
                # the legacy tautological 150-WPM estimate. This is *the*
                # post-session fix that keeps in-session and dashboard numbers
                # consistent.
                try:
                    user_words, user_seconds, samples = pacing_tracker.get_session_totals()
                    if user_seconds > 0:
                        advanced_metrics.basic_collector.set_measured_speaking_seconds(
                            user_seconds=user_seconds
                        )
                        logger.info(
                            "📐 Plumbed measured user pacing into basic_collector: "
                            f"{user_words} words / {user_seconds:.2f}s "
                            f"({(user_words / user_seconds) * 60:.1f} WPM, {samples} samples)"
                        )
                    else:
                        logger.info("📐 LivePacingTracker produced no measured seconds — falling back to wall-clock estimate")
                except Exception as _e:
                    logger.warning(f"⚠️  Could not plumb pacing data into metrics: {_e}")

                # Time-bound the heavy analytics. finalize_session() flushes basic
                # metrics (turns, WPM) FIRST, then runs optional Gentle/Praat audio
                # alignment which can take 1–2× realtime. LiveKit cancels the whole
                # entrypoint at its ~30s shutdown deadline, so an unbounded Gentle
                # call here would starve the per-turn (SessionTurn) persistence that
                # runs afterward — leaving every session stuck on the degraded
                # transcript fallback. Cap it so the basic metrics land and the
                # slow delivery pass is abandoned within budget (the v2 /analyze
                # pipeline recomputes delivery server-side anyway).
                try:
                    await asyncio.wait_for(
                        advanced_metrics.finalize_session(
                            user_audio_file_path=local_user_audio_path
                        ),
                        timeout=12.0,
                    )
                    logger.info("✅ Advanced analytics processing complete!")
                except asyncio.TimeoutError:
                    logger.warning(
                        "⏱️ finalize_session exceeded 12s (likely Gentle alignment) — "
                        "basic metrics kept, delivery pass abandoned so SessionTurn "
                        "persistence can run within the shutdown budget"
                    )
                
                # Log summary of results
                if advanced_metrics.session_metrics.basic_metrics:
                    user_wpm = advanced_metrics.session_metrics.basic_metrics.user_metrics.words_per_minute
                    total_turns = advanced_metrics.session_metrics.basic_metrics.total_turns
                    total_tokens = advanced_metrics.session_metrics.basic_metrics.total_llm_tokens
                    logger.info(f"📊 Basic metrics: {total_turns} turns, {user_wpm:.1f} WPM, {total_tokens} tokens")
                
                if advanced_metrics.session_metrics.performance_insights:
                    overall_score = advanced_metrics.session_metrics.performance_insights.scores.overall
                    logger.info(f"🎯 Overall score: {overall_score:.1f}/10")
                
                # Save advanced metrics to database
                logger.info("💾 Saving advanced metrics to database...")
                if persistence_enabled:
                    await advanced_metrics.save_to_database()
                    logger.info("✅ Metrics saved to database!")
                else:
                    logger.warning("⚠️ Skipping metrics DB save (ephemeral mode)")
                
                # 6. Mark session as ended in the database
                if persistence_enabled:
                    try:
                        import aiohttp
                        async with aiohttp.ClientSession() as session:
                            end_url = f"{SERVER_URL}/sessions/{session_id}/end"
                            end_payload = {
                                "endedAt": advanced_metrics.session_metrics.end_time.isoformat(),
                                "durationSec": int((advanced_metrics.session_metrics.end_time - advanced_metrics.session_metrics.start_time).total_seconds()) if advanced_metrics.session_metrics.start_time else 0
                            }
                            async with session.post(
                                end_url,
                                json=end_payload,
                                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                                timeout=aiohttp.ClientTimeout(total=5.0),
                            ) as response:
                                if response.status == 200:
                                    logger.info(f"✅ Session marked as ended in database")
                                else:
                                    logger.warning(f"⚠️ Failed to mark session as ended: {response.status}")
                    except Exception as end_error:
                        logger.error(f"❌ Error marking session as ended: {end_error}")
                else:
                    logger.warning("⚠️ Skipping session end DB mark (ephemeral mode)")

            except Exception as analytics_error:
                logger.error(f"❌ Error processing advanced analytics: {analytics_error}", exc_info=True)
                advanced_metrics.session_metrics.processing_errors.append(str(analytics_error))

        # ── Persist per-turn replay records (SessionTurn) ──────────────────
        # Runs independently of audio/analytics success so the replay always has
        # data. Build per-turn rows from committed turns + captured STT word
        # timings. User words are sliced greedily by word count (both streams are
        # chronological); assistant turns carry text only.
        if persistence_enabled and advanced_metrics:
            try:
                stt_words = list(getattr(agent, "_stt_words", []) or [])
                stt_segments = list(getattr(agent, "_stt_segments", []) or [])
                committed_turns = advanced_metrics.basic_collector.session_metrics.turns or []
                committed_user_meta = locals().get("committed_user_turns", {}) or {}
                turns_payload: list[dict] = []
                user_seq = 0
                word_cursor = 0
                for idx, t in enumerate(committed_turns):
                    text = (t.text or "").strip()
                    if not text:
                        continue
                    entry: dict = {"turnIndex": idx, "role": t.speaker, "text": text}
                    if t.speaker == "user":
                        user_seq += 1
                        meta = committed_user_meta.get(user_seq)
                        if meta and meta.get("metrics"):
                            entry["metrics"] = meta["metrics"]
                        n = t.word_count or len(text.split())
                        slice_words = stt_words[word_cursor : word_cursor + n]
                        word_cursor += n
                        if slice_words:
                            entry["audioStart"] = slice_words[0]["start"]
                            entry["audioEnd"] = slice_words[-1]["end"]
                            entry["words"] = slice_words
                    turns_payload.append(entry)

                if turns_payload:
                    import aiohttp
                    async with aiohttp.ClientSession() as _ts:
                        turns_url = f"{SERVER_URL}/internal/sessions/{session_id}/turns"
                        post_body: dict = {"turns": turns_payload}
                        # STT timeline t0 (epoch ms). The server shifts all
                        # offsets onto the recording timeline using this anchor
                        # vs Session.recordingStartedAt, cancelling the variable
                        # greeting/lead-in gap so karaoke matches the audio.
                        if agent._stt_t0_epoch is not None:
                            post_body["sttEpochMs"] = int(agent._stt_t0_epoch * 1000)
                        async with _ts.post(
                            turns_url,
                            json=post_body,
                            headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                            timeout=aiohttp.ClientTimeout(total=10.0),
                        ) as resp:
                            if resp.status in (200, 201):
                                logger.info(
                                    f"✅ Persisted {len(turns_payload)} SessionTurn rows "
                                    f"({len(stt_words)} STT words from {len(stt_segments)} segments)"
                                )
                            else:
                                logger.warning(f"⚠️ SessionTurn persist returned {resp.status}")
            except Exception as turns_error:
                logger.error(f"❌ Error persisting session turns: {turns_error}")

        # ── Auto-trigger v2 analytics so insights are never empty ──────────
        # Runs server-side (signal API + skill scores + Bedrock) even if the user
        # closes the tab before the frontend can call /analyze.
        if persistence_enabled:
            try:
                import aiohttp
                async with aiohttp.ClientSession() as _as:
                    analyze_url = f"{SERVER_URL}/sessions/{session_id}/analyze"
                    async with _as.post(
                        analyze_url,
                        json={"autoTrackPulse": True, "source": "elevate"},
                        headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                        timeout=aiohttp.ClientTimeout(total=60.0),
                    ) as resp:
                        if resp.status == 200:
                            logger.info("✅ v2 analytics pipeline triggered at session end")
                        else:
                            logger.warning(f"⚠️ /analyze returned {resp.status}")
            except Exception as analyze_error:
                logger.error(f"❌ Error triggering v2 analytics: {analyze_error}")

        if conversation_logger:
            await conversation_logger.close()
        logger.info("🧹 Cleanup completed")

def _cleanup_children():
    """Kill all child processes in our process group on exit.
    Prevents orphaned multiprocessing workers from registering as
    stale LiveKit agent workers after the parent is killed."""
    try:
        os.killpg(os.getpgid(os.getpid()), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass

if __name__ == "__main__":
    # Ensure we are the process group leader so killpg reaches all children
    try:
        os.setpgrp()
    except OSError:
        pass
    atexit.register(_cleanup_children)

    # Also handle SIGTERM/SIGINT to clean up children before exiting
    def _signal_handler(sig, frame):
        logger.info("🛑 Received signal %s — cleaning up child processes", sig)
        _cleanup_children()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            num_idle_processes=1,
        )
    )