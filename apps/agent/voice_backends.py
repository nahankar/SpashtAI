"""
SpashtAI Voice Backend Factory
─────────────────────────────────────────────────────────────────────────────
Returns a configured `AgentSession` based on the active voice backend, which
is read from LiveKit room metadata (set by the server in routes/livekit.ts).

Supported backends (extensible):

  • "nova-sonic"        → AWS Bedrock Nova Sonic speech-to-speech (cloud).
                          Default. Requires valid AWS Bedrock credentials.

  • "pipeline-premium"  → Local pipeline:
                            STT  : faster-whisper-server (large-v3-turbo)
                            LLM  : Ollama → qwen2.5:32b
                            TTS  : Kokoro-FastAPI
                          ~700ms latency, fully offline. Falls back to
                          Nova Sonic if any pipeline server is unreachable.

  • "pipeline-bedrock"  → Composable cloud/hybrid pipeline:
                            VAD  : Silero for Whisper only (Transcribe endpointing alone)
                            STT  : Whisper (HTTP) OR AWS Transcribe Streaming
                            LLM  : Bedrock Nova Lite (live coaching; Pro is session-end only)
                            TTS  : Kokoro (HTTP) OR AWS Polly
                          Admin selects STT/TTS providers via voice config.

Adding a new backend = add a branch in `build_session`. The rest of the
agent (transcript handlers, metrics collectors, recording) is unchanged.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

from livekit.agents import AgentSession
from livekit.plugins import aws

logger = logging.getLogger("spashtai-agent.voice_backends")


_TURN_DETECTION_LEVELS = frozenset({"HIGH", "MEDIUM", "LOW", "EXTRA"})
_STT_PROVIDERS = frozenset({"whisper", "transcribe"})
_TTS_PROVIDERS = frozenset({"kokoro", "polly"})


def _normalize_turn_detection(value: Optional[str]) -> str:
    level = (value or "MEDIUM").strip().upper()
    return level if level in _TURN_DETECTION_LEVELS else "MEDIUM"


def _normalize_stt_provider(value: Optional[str]) -> str:
    provider = (value or "whisper").strip().lower()
    return provider if provider in _STT_PROVIDERS else "whisper"


def _normalize_tts_provider(value: Optional[str]) -> str:
    provider = (value or "kokoro").strip().lower()
    return provider if provider in _TTS_PROVIDERS else "kokoro"


def _nova_turn_detection(value: Optional[str]) -> str:
    """Nova Sonic only accepts HIGH/MEDIUM/LOW — EXTRA maps to LOW (~2s AWS max)."""
    level = _normalize_turn_detection(value)
    return "LOW" if level == "EXTRA" else level


def _pipeline_min_silence_duration(value: Optional[str]) -> float:
    level = _normalize_turn_detection(value)
    return {
        "HIGH": 0.75,
        "MEDIUM": 1.25,
        "LOW": 2.0,
        "EXTRA": 4.0,
    }.get(level, 1.25)


# Display granularity, decoupled from turn patience. A SHORT VAD silence closes
# speech segments frequently, so batch Whisper emits an incremental transcript
# after each phrase → the user's bubble grows live as they speak (the behaviour
# that worked in the early pipeline-premium tests). Turn *completion* is governed
# separately by the endpointing delay below, so monologues still aren't truncated.
_VAD_SEGMENTATION_SILENCE = 0.8


def _vad_segmentation_silence(turn_detection: Optional[str]) -> float:
    """VAD silence for STT chunking (live display), never longer than endpointing."""
    return min(_VAD_SEGMENTATION_SILENCE, _pipeline_min_silence_duration(turn_detection))


def _bedrock_region() -> str:
    return os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))


def _default_pipeline_llm() -> str:
    return os.getenv("BEDROCK_PIPELINE_LLM", "amazon.nova-lite-v1:0")


@dataclass
class VoiceBackendConfig:
    """Settings extracted from LiveKit room metadata."""

    backend: str = "nova-sonic"
    voice_name: Optional[str] = None
    turn_detection: str = "MEDIUM"
    stt_provider: str = "whisper"
    tts_provider: str = "kokoro"
    pipeline_stt: Optional[str] = None
    pipeline_llm: Optional[str] = None
    pipeline_tts: Optional[str] = None
    stt_base_url: Optional[str] = None
    llm_base_url: Optional[str] = None
    tts_base_url: Optional[str] = None

    @classmethod
    def from_room_meta(cls, meta: dict) -> "VoiceBackendConfig":
        return cls(
            backend=(meta.get("voiceBackend") or "nova-sonic").strip(),
            voice_name=(meta.get("voiceName") or None),
            turn_detection=_normalize_turn_detection(meta.get("turnDetection")),
            stt_provider=_normalize_stt_provider(meta.get("sttProvider")),
            tts_provider=_normalize_tts_provider(meta.get("ttsProvider")),
            pipeline_stt=(meta.get("pipelineStt") or None),
            pipeline_llm=(meta.get("pipelineLlm") or None),
            pipeline_tts=(meta.get("pipelineTts") or None),
            stt_base_url=(meta.get("sttBaseUrl") or None),
            llm_base_url=(meta.get("llmBaseUrl") or None),
            tts_base_url=(meta.get("ttsBaseUrl") or None),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Backend builders
# ─────────────────────────────────────────────────────────────────────────────

def _build_nova_sonic(cfg: VoiceBackendConfig) -> AgentSession:
    region = _bedrock_region()
    voice = cfg.voice_name or "tiffany"
    turn_detection = _nova_turn_detection(cfg.turn_detection)
    model_id = os.getenv("BEDROCK_NOVASONIC_MODEL_ID", "amazon.nova-2-sonic-v1:0")
    realtime_model = aws.realtime.RealtimeModel(
        model=model_id,
        region=region,
        voice=voice,
        temperature=0.7,
        top_p=0.9,
        max_tokens=1024,
        turn_detection=turn_detection,
    )
    logger.info(
        "✅ Backend=nova-sonic | voice=%s region=%s model=%s turn_detection=%s (requested=%s)",
        voice,
        region,
        model_id,
        turn_detection,
        cfg.turn_detection,
    )
    return AgentSession(llm=realtime_model, use_tts_aligned_transcript=True)


def _build_pipeline_premium(cfg: VoiceBackendConfig) -> AgentSession:
    """Local pipeline: faster-whisper STT + Ollama LLM + Kokoro TTS + Silero VAD."""
    from livekit.plugins import openai as lk_openai
    from livekit.plugins import silero

    stt_url = cfg.stt_base_url or "http://localhost:8001/v1"
    llm_url = cfg.llm_base_url or "http://localhost:11434/v1"
    tts_url = cfg.tts_base_url or "http://localhost:8002/v1"

    stt_model = cfg.pipeline_stt or "deepdml/faster-whisper-large-v3-turbo-ct2"
    llm_model = cfg.pipeline_llm or "qwen2.5:32b"
    tts_voice = cfg.voice_name or "af_bella"
    tts_label = cfg.pipeline_tts or "kokoro"

    stt = lk_openai.STT(
        base_url=stt_url,
        api_key="local",
        model=stt_model,
        language="en",
    )

    llm = lk_openai.LLM(
        base_url=llm_url,
        api_key="ollama",
        model=llm_model,
        temperature=0.7,
    )

    tts = lk_openai.TTS(
        base_url=tts_url,
        api_key="local",
        model="tts-1",
        voice=tts_voice,
        response_format="mp3",
    )

    # Turn patience vs. STT chunking are decoupled (see _vad_segmentation_silence):
    # short VAD silence → live word-growth in the bubble; longer endpointing →
    # the coach waits for a real pause before replying (monologues not truncated).
    endpoint_silence = _pipeline_min_silence_duration(cfg.turn_detection)
    vad_silence = _vad_segmentation_silence(cfg.turn_detection)
    vad = silero.VAD.load(min_silence_duration=vad_silence)

    logger.info(
        "✅ Backend=pipeline-premium | STT=%s LLM=%s TTS=%s voice=%s "
        "vad_silence=%.2fs endpointing=%.2f-%.2fs (requested=%s)",
        stt_model,
        llm_model,
        tts_label,
        tts_voice,
        vad_silence,
        endpoint_silence,
        endpoint_silence + 2.0,
        cfg.turn_detection,
    )
    logger.info("   STT %s | LLM %s | TTS %s", stt_url, llm_url, tts_url)

    return AgentSession(
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts,
        use_tts_aligned_transcript=True,
        # Local VAD interruptions only — skip LiveKit Cloud barge-in (401 on self-host).
        # preemptive_generation disabled: on_user_turn_completed injects per-turn
        # metrics/guards into the chat context, which invalidates a preemptive
        # generation and (in 1.5.8) stalls the reply until the next user input.
        turn_handling={
            "endpointing": {
                "mode": "dynamic",
                "min_delay": endpoint_silence,
                "max_delay": endpoint_silence + 2.0,
            },
            "interruption": {"mode": "vad"},
            "preemptive_generation": {"enabled": False},
        },
    )


def _build_pipeline_bedrock_stt(cfg: VoiceBackendConfig):
    """STT: Whisper (OpenAI-compat HTTP) or AWS Transcribe Streaming."""
    if cfg.stt_provider == "transcribe":
        region = _bedrock_region()
        logger.info("   STT provider=transcribe region=%s (partial stabilization=high)", region)
        # Partial-results stabilization keeps interim transcripts from being
        # heavily rewritten word-to-word ("high" = least revision), so the live
        # user bubble grows smoothly instead of flickering.
        return aws.STT(
            region=region,
            language="en-US",
            enable_partial_results_stabilization=True,
            partial_results_stability="high",
        )

    from livekit.plugins import openai as lk_openai

    stt_url = cfg.stt_base_url or os.getenv(
        "PIPELINE_STT_URL", "http://localhost:8001/v1"
    )
    stt_model = cfg.pipeline_stt or "deepdml/faster-whisper-large-v3-turbo-ct2"
    logger.info("   STT provider=whisper model=%s url=%s", stt_model, stt_url)
    return lk_openai.STT(
        base_url=stt_url,
        api_key="local",
        model=stt_model,
        language="en",
    )


def _build_pipeline_bedrock_llm(cfg: VoiceBackendConfig):
    """LLM: Bedrock Nova Lite (converse_stream) for low-latency live coaching."""
    region = _bedrock_region()
    model = cfg.pipeline_llm or _default_pipeline_llm()
    logger.info("   LLM model=%s region=%s", model, region)
    return aws.LLM(model=model, region=region, temperature=0.7)


def _build_pipeline_bedrock_tts(cfg: VoiceBackendConfig):
    """TTS: Kokoro (OpenAI-compat HTTP) or AWS Polly."""
    if cfg.tts_provider == "polly":
        region = _bedrock_region()
        voice = cfg.voice_name or "Ruth"
        logger.info("   TTS provider=polly voice=%s region=%s", voice, region)
        return aws.TTS(
            voice=voice,
            speech_engine="generative",
            region=region,
            language="en-US",
        )

    from livekit.plugins import openai as lk_openai

    tts_url = cfg.tts_base_url or os.getenv(
        "PIPELINE_TTS_URL", "http://localhost:8002/v1"
    )
    tts_voice = cfg.voice_name or "af_bella"
    logger.info("   TTS provider=kokoro voice=%s url=%s", tts_voice, tts_url)
    return lk_openai.TTS(
        base_url=tts_url,
        api_key="local",
        model="tts-1",
        voice=tts_voice,
        response_format="mp3",
    )


def _build_pipeline_bedrock(cfg: VoiceBackendConfig) -> AgentSession:
    """Composable pipeline: STT + Nova Lite + TTS; patient Silero VAD for all STT providers."""
    stt = _build_pipeline_bedrock_stt(cfg)
    llm = _build_pipeline_bedrock_llm(cfg)
    tts = _build_pipeline_bedrock_tts(cfg)

    from livekit.plugins import silero

    # Turn patience (when the coach is allowed to reply) — the configurable knob.
    endpoint_silence = _pipeline_min_silence_duration(cfg.turn_detection)
    # STT chunking (how often the live bubble grows) — short + fixed, decoupled
    # from patience so monologues stream live yet aren't truncated.
    vad_silence = _vad_segmentation_silence(cfg.turn_detection)
    session_kwargs: dict = {
        "stt": stt,
        "llm": llm,
        "tts": tts,
        "vad": silero.VAD.load(min_silence_duration=vad_silence),
        "use_tts_aligned_transcript": True,
        "user_away_timeout": 120.0,
        # interruption.mode="vad" avoids the LiveKit Cloud "Adaptive Interruption"
        # barge-in service (wss://agent-gateway.livekit.cloud/v1/bargein), which
        # 401s on self-hosted LiveKit and spams tracebacks in `dev` mode. Local
        # Silero VAD handles interruptions. Endpointing must live here too — when
        # turn_handling is provided, the deprecated min/max_endpointing_delay args
        # are ignored.
        "turn_handling": {
            "endpointing": {
                "mode": "dynamic",
                "min_delay": endpoint_silence,
                "max_delay": endpoint_silence + 2.0,
            },
            "interruption": {"mode": "vad"},
            # Disabled: per-turn metrics/guard injection in on_user_turn_completed
            # invalidates preemptive generation, which (in 1.5.8) stalls the coach
            # reply until the next user utterance — the "landed late" symptom.
            "preemptive_generation": {"enabled": False},
        },
    }

    logger.info(
        "✅ Backend=pipeline-bedrock | stt=%s tts=%s llm=%s voice=%s "
        "vad=silero vad_silence=%.2fs endpointing=%.2f-%.2fs (requested=%s)",
        cfg.stt_provider,
        cfg.tts_provider,
        cfg.pipeline_llm or _default_pipeline_llm(),
        cfg.voice_name,
        vad_silence,
        endpoint_silence,
        endpoint_silence + 2.0,
        cfg.turn_detection,
    )

    return AgentSession(**session_kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

async def _tcp_check(host: str, port: int, timeout: float = 3.0) -> bool:
    """Bare TCP-connect probe. Cheaper and more reliable than HTTP for liveness."""
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _host_port_from_url(base_url: str, default_port: int) -> tuple[str, int]:
    from urllib.parse import urlparse

    p = urlparse(base_url)
    host = p.hostname or "localhost"
    port = p.port or default_port
    return host, port


async def _pipeline_bedrock_health(cfg: VoiceBackendConfig) -> tuple[bool, dict[str, bool]]:
    """Check only the providers that need local/remote TCP endpoints."""
    checks: dict[str, bool] = {}

    if cfg.stt_provider == "whisper":
        stt_url = cfg.stt_base_url or os.getenv(
            "PIPELINE_STT_URL", "http://localhost:8001/v1"
        )
        host, port = _host_port_from_url(stt_url, 8001)
        checks["stt"] = await _tcp_check(host, port)
    else:
        checks["stt"] = True  # Transcribe — IAM at runtime

    if cfg.tts_provider == "kokoro":
        tts_url = cfg.tts_base_url or os.getenv(
            "PIPELINE_TTS_URL", "http://localhost:8002/v1"
        )
        host, port = _host_port_from_url(tts_url, 8002)
        checks["tts"] = await _tcp_check(host, port)
    else:
        checks["tts"] = True  # Polly — IAM at runtime

    return all(checks.values()), checks


async def build_session(cfg: VoiceBackendConfig) -> AgentSession:
    """
    Build an `AgentSession` for the requested backend.

    Falls back to Nova Sonic if a pipeline backend is selected but required
    servers are not reachable — keeps Elevate working if Whisper/Kokoro is down.
    """
    backend = cfg.backend or "nova-sonic"

    if backend == "nova-sonic":
        return _build_nova_sonic(cfg)

    if backend == "pipeline-premium":
        stt_host, stt_port = _host_port_from_url(cfg.stt_base_url or "http://localhost:8001/v1", 8001)
        llm_host, llm_port = _host_port_from_url(cfg.llm_base_url or "http://localhost:11434/v1", 11434)
        tts_host, tts_port = _host_port_from_url(cfg.tts_base_url or "http://localhost:8002/v1", 8002)

        ok_stt, ok_llm, ok_tts = await asyncio.gather(
            _tcp_check(stt_host, stt_port),
            _tcp_check(llm_host, llm_port),
            _tcp_check(tts_host, tts_port),
        )

        if not (ok_stt and ok_llm and ok_tts):
            logger.error(
                "⚠️  Pipeline servers not all reachable (STT=%s @ %s:%s, LLM=%s @ %s:%s, "
                "TTS=%s @ %s:%s); falling back to nova-sonic",
                ok_stt, stt_host, stt_port,
                ok_llm, llm_host, llm_port,
                ok_tts, tts_host, tts_port,
            )
            return _build_nova_sonic(cfg)
        return _build_pipeline_premium(cfg)

    if backend == "pipeline-bedrock":
        ok, checks = await _pipeline_bedrock_health(cfg)
        if not ok:
            logger.error(
                "⚠️  pipeline-bedrock health failed (stt=%s, tts=%s); falling back to nova-sonic",
                checks.get("stt"),
                checks.get("tts"),
            )
            return _build_nova_sonic(cfg)
        return _build_pipeline_bedrock(cfg)

    logger.warning("Unknown voice backend '%s' — falling back to nova-sonic", backend)
    return _build_nova_sonic(cfg)


async def apply_turn_detection_update(
    agent_session: AgentSession,
    cfg: VoiceBackendConfig,
    level: str,
) -> bool:
    """
    Hot-update turn-taking mid-session.

    Nova Sonic: updates Bedrock endpointing and recycles the realtime stream.
    Pipeline: not hot-swappable — caller should ask the user to pause/resume.
    """
    cfg.turn_detection = _normalize_turn_detection(level)

    if cfg.backend != "nova-sonic":
        logger.info(
            "turn_detection stored as %s; pipeline VAD applies on next session start",
            cfg.turn_detection,
        )
        return False

    llm_model = agent_session.llm
    if llm_model is None:
        return False

    try:
        from livekit.plugins.aws.experimental.realtime.realtime_model import RealtimeModel
    except ImportError:
        logger.warning("AWS realtime plugin unavailable for turn_detection update")
        return False

    if not isinstance(llm_model, RealtimeModel):
        return False

    nova_level = _nova_turn_detection(cfg.turn_detection)
    llm_model._opts.turn_detection = nova_level  # type: ignore[attr-defined]

    sessions = list(llm_model._sessions)  # type: ignore[attr-defined]
    if not sessions:
        logger.warning("No active Nova Sonic session to recycle")
        return False

    rt_session = sessions[-1]
    try:
        await rt_session._graceful_session_recycle()  # type: ignore[attr-defined]
        logger.info(
            "♻️ Nova Sonic turn_detection updated to %s (requested=%s)",
            nova_level,
            cfg.turn_detection,
        )
        return True
    except Exception as exc:
        logger.error("Failed to recycle Nova Sonic session: %s", exc)
        return False


def metadata_label(cfg: VoiceBackendConfig) -> str:
    """Human-readable model identifier for room metadata broadcasts."""
    if cfg.backend == "nova-sonic":
        return "AWS Nova Sonic"
    if cfg.backend == "pipeline-premium":
        llm = cfg.pipeline_llm or "qwen2.5:32b"
        return f"Local pipeline ({llm})"
    if cfg.backend == "pipeline-bedrock":
        llm = cfg.pipeline_llm or _default_pipeline_llm()
        return f"Pipeline ({cfg.stt_provider}/{cfg.tts_provider}, {llm})"
    return cfg.backend
