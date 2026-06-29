"""Per-path behavioral profiles for the voice backends.

The three voice paths share one entrypoint and one set of transcript / metrics /
recording handlers (that shared code is intentionally NOT duplicated — doing so
would be the real tech debt). What differs between paths is a small set of
*behavioral* knobs. This module is the single source of truth for those knobs so
that tuning one path (e.g. the Full AWS Cloud path) cannot silently regress the
others.

Paths:
  • aws-cloud   → pipeline-bedrock with Transcribe (streaming) + Nova Lite + Polly
  • local       → pipeline-premium: faster-whisper + Ollama + Kokoro
  • s2s         → nova-sonic: Bedrock RealtimeModel (speech-to-speech)

`pipeline-bedrock` can also run Whisper instead of Transcribe (batch), so the STT
mode is derived from `stt_provider`, not just the backend name.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from voice_backends import VoiceBackendConfig


class SttMode(str, Enum):
    """How the user's transcript arrives — drives live-partial handling."""

    STREAMING = "streaming"  # Transcribe: is_partial interims grow the bubble live
    BATCH = "batch"          # Whisper: one (or a few VAD-segment) finals per turn
    S2S = "s2s"              # Nova Sonic: speech-to-speech, transcript via items


@dataclass(frozen=True)
class BackendProfile:
    """Everything about a voice path that the shared entrypoint must branch on."""

    # Human-facing path label (for logs / metadata).
    path: str

    # Cascaded STT→LLM→TTS pipeline (adds the "PIPELINE MODE" prompt block and
    # uses the live-partial publish path). False only for nova-sonic (S2S).
    is_pipeline: bool

    # Publish raw STT fragments via conversation_item_added. Only nova-sonic needs
    # this (it has no live-partial path); the pipelines would create duplicate
    # bubbles, so they publish via the user_turn_N live-partial path instead.
    publish_user_fragments: bool

    # Monologue guard suppresses premature backchannels. Only meaningful for
    # nova-sonic's aggressive streaming endpointing; the turn-based pipelines use
    # patient Silero endpointing and would be falsely cut by the guard.
    monologue_guard_supported: bool

    # How the user's transcript is delivered (see SttMode).
    stt_mode: SttMode

    @property
    def is_streaming_stt(self) -> bool:
        return self.stt_mode is SttMode.STREAMING


def profile_for(cfg: VoiceBackendConfig) -> BackendProfile:
    """Resolve the behavioral profile for a given backend config."""
    backend = (cfg.backend or "nova-sonic").strip()

    if backend == "nova-sonic":
        return BackendProfile(
            path="s2s",
            is_pipeline=False,
            publish_user_fragments=True,
            monologue_guard_supported=True,
            stt_mode=SttMode.S2S,
        )

    if backend == "pipeline-premium":
        return BackendProfile(
            path="local",
            is_pipeline=True,
            publish_user_fragments=False,
            monologue_guard_supported=False,
            stt_mode=SttMode.BATCH,  # faster-whisper is batch
        )

    if backend == "pipeline-bedrock":
        streaming = (cfg.stt_provider or "whisper").strip().lower() == "transcribe"
        return BackendProfile(
            path="aws-cloud",
            is_pipeline=True,
            publish_user_fragments=False,
            monologue_guard_supported=False,
            stt_mode=SttMode.STREAMING if streaming else SttMode.BATCH,
        )

    # Unknown backend → safest default mirrors the nova-sonic fallback in
    # build_session() so behavior stays consistent.
    return BackendProfile(
        path="s2s",
        is_pipeline=False,
        publish_user_fragments=True,
        monologue_guard_supported=True,
        stt_mode=SttMode.S2S,
    )
