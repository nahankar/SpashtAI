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


@dataclass
class VoiceBackendConfig:
    """Settings extracted from LiveKit room metadata."""

    backend: str = "nova-sonic"
    voice_name: Optional[str] = None
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
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    voice = cfg.voice_name or "tiffany"
    realtime_model = aws.realtime.RealtimeModel(
        region=region,
        voice=voice,
        temperature=0.7,
        top_p=0.9,
        max_tokens=1024,
    )
    logger.info("✅ Backend=nova-sonic | voice=%s region=%s", voice, region)
    return AgentSession(llm=realtime_model, use_tts_aligned_transcript=True)


def _build_pipeline_premium(cfg: VoiceBackendConfig) -> AgentSession:
    """Local pipeline: faster-whisper STT + Ollama LLM + Kokoro TTS + Silero VAD."""
    # Imported lazily so a missing optional dep can't crash the whole module
    from livekit.plugins import openai as lk_openai
    from livekit.plugins import silero

    stt_url = cfg.stt_base_url or "http://localhost:8001/v1"
    llm_url = cfg.llm_base_url or "http://localhost:11434/v1"
    tts_url = cfg.tts_base_url or "http://localhost:8002/v1"

    stt_model = cfg.pipeline_stt or "deepdml/faster-whisper-large-v3-turbo-ct2"
    llm_model = cfg.pipeline_llm or "qwen2.5:32b"
    tts_voice = cfg.voice_name or "af_bella"
    tts_label = cfg.pipeline_tts or "kokoro"

    # STT: speaches / faster-whisper-server speaks the OpenAI Audio API dialect.
    # `language="en"` is the plugin default; we keep it explicit so multi-language
    # detection doesn't slow down each utterance.
    stt = lk_openai.STT(
        base_url=stt_url,
        api_key="local",
        model=stt_model,
        language="en",
    )

    # LLM: Ollama exposes the OpenAI Chat Completions API on /v1
    llm = lk_openai.LLM(
        base_url=llm_url,
        api_key="ollama",  # Ollama ignores the key but the SDK requires one
        model=llm_model,
        temperature=0.7,
    )

    # TTS: Kokoro-FastAPI / Orpheus-FastAPI / etc. expose /v1/audio/speech in the
    # OpenAI dialect. The LiveKit OpenAI TTS plugin has TWO transports keyed by
    # model name:
    #   • model in {"tts-1","tts-1-hd"}  → raw audio HTTP stream  (what local servers speak)
    #   • anything else                  → Server-Sent Events for gpt-4o-mini-tts
    # We always pin "tts-1" here so the simple raw-audio path is selected; the
    # actual TTS engine is whatever Kokoro/Orpheus is bundled with — the model
    # field is ignored by those servers in OpenAI-compat mode.
    tts = lk_openai.TTS(
        base_url=tts_url,
        api_key="local",
        model="tts-1",
        voice=tts_voice,
        response_format="mp3",
    )

    vad = silero.VAD.load()

    logger.info(
        "✅ Backend=pipeline-premium | STT=%s LLM=%s TTS=%s voice=%s",
        stt_model,
        llm_model,
        tts_label,
        tts_voice,
    )
    logger.info("   STT %s | LLM %s | TTS %s", stt_url, llm_url, tts_url)

    return AgentSession(
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts,
        use_tts_aligned_transcript=True,
    )


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


async def build_session(cfg: VoiceBackendConfig) -> AgentSession:
    """
    Build an `AgentSession` for the requested backend.

    Falls back to Nova Sonic if a pipeline backend is selected but its servers
    are not reachable — this keeps Elevate working even if the operator forgot
    to start `start-local-stack.sh`.
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

    logger.warning("Unknown voice backend '%s' — falling back to nova-sonic", backend)
    return _build_nova_sonic(cfg)


def metadata_label(cfg: VoiceBackendConfig) -> str:
    """Human-readable model identifier for room metadata broadcasts."""
    if cfg.backend == "nova-sonic":
        return "AWS Nova Sonic"
    if cfg.backend == "pipeline-premium":
        llm = cfg.pipeline_llm or "qwen2.5:32b"
        return f"Local pipeline ({llm})"
    return cfg.backend
