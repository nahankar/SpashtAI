"""Fail-safe, server-side Hush boundary for the Pipeline Bedrock agent path.

Hush is a third-party LiveKit plugin, not a browser processor and not a
speaker-enrolled voice-isolation system.  This module deliberately contains
every non-public plugin dependency so the main agent remains on its established
raw audio path unless a *new room* explicitly requests Hush.

If initialization or frame processing fails, the processor returns the raw
frame and marks the session as a labelled baseline fallback.  Learner sessions
must remain available even when the optional cleanup model is unhealthy.
"""
from __future__ import annotations

import hashlib
import logging
import math
import threading
import time
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, distribution, version
from pathlib import Path
from typing import Any, Callable

from livekit import rtc


log = logging.getLogger("spashtai-agent.hush")

PINNED_VERSION = "0.3.3"
PINNED_COMMIT = "ab84d83864003d835013b4e914fca8df83b2cbc6"
PINNED_SOURCE_SHA256 = {
    "__init__.py": "f650741024608df29bd8cc24e2729b62074019804aca3ff047612842e00e2c75",
    "_hush_model.py": "ededea6457bf0ed12ab1f3f761963c486089b5877c4f74a440e2ffb3dea6ada4",
    "noise_suppressor.py": "8c091b2e670a4f6884b0b10f5a940b52a42a2727de27566358c685567e83eddd",
    "_libdf/__init__.py": "91a5f76177cddaf13976373f4f77e9fc0e386150668f60592fca3fdc2e7d1f82",
}
PINNED_MODEL_SHA256 = {
    "enc.onnx": "eed80a17a2e4f33209e648cf35fdd3719499319771bdf2aa3fe4b56a48cfeaba",
    "erb_dec.onnx": "dfda32e6d3ad8bf68e075c12b5319c3a9ed264e3eb1c9da20261eeda04ea1a9a",
    "df_dec.onnx": "dae10024478a0cef057eeb91021a927c631af6387789fc88ce0f57621c7b269b",
}


class HushContractError(RuntimeError):
    """The pinned plugin or its packaged model does not match the reviewed one."""


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_plugin_artifact() -> dict[str, Any]:
    """Verify the exact reviewed package before it receives any learner audio."""
    try:
        installed = version("livekit-plugins-hush")
        package = distribution("livekit-plugins-hush")
    except PackageNotFoundError as exc:
        raise HushContractError("livekit-plugins-hush is not installed") from exc
    if installed != PINNED_VERSION:
        raise HushContractError(
            f"livekit-plugins-hush {installed} installed; expected {PINNED_VERSION}"
        )

    # Locate and verify every source/model file from package metadata *before*
    # importing the third-party module.  This prevents unreviewed plugin code
    # from executing merely because an admin has enabled an optional feature.
    plugin_dir = Path(package.locate_file("livekit/plugins/hush"))
    model_dir = plugin_dir / "models"
    if not model_dir.exists():
        raise HushContractError("Hush model directory is unavailable")

    sources: dict[str, bool] = {}
    for relative, expected in PINNED_SOURCE_SHA256.items():
        candidate = plugin_dir / relative
        actual = _sha256(candidate) if candidate.exists() else None
        sources[relative] = actual == expected
        if actual != expected:
            raise HushContractError(f"Hush source hash mismatch: {relative}")

    models: dict[str, bool] = {}
    for name, expected in PINNED_MODEL_SHA256.items():
        candidate = model_dir / name
        actual = _sha256(candidate) if candidate.exists() else None
        models[name] = actual == expected
        if actual != expected:
            raise HushContractError(f"Hush model hash mismatch: {name}")

    return {
        "version": installed,
        "commit": PINNED_COMMIT,
        "source_hashes_verified": sources,
        "model_hashes_verified": models,
    }


@dataclass
class HushRuntime:
    requested: bool
    effective: bool = False
    processor: Any | None = None
    failure_reason: str | None = None
    artifact: dict[str, Any] | None = None
    on_status_change: Callable[["HushRuntime"], None] | None = None
    _closed: bool = False

    def mark_fallback(self, reason: str) -> None:
        if self.failure_reason is None:
            self.failure_reason = reason
            self.effective = False
            log.error("hush runtime fallback to raw audio: %s", reason)
            if self.on_status_change:
                try:
                    self.on_status_change(self)
                except Exception:  # status telemetry must never interrupt audio
                    log.exception("hush status callback failed")

    def status(self) -> dict[str, Any]:
        stats = self.processor.snapshot() if self.processor and hasattr(self.processor, "snapshot") else {}
        return {
            "hushRequested": self.requested,
            "hushEffective": self.effective,
            "hushState": (
                "disabled"
                if not self.requested
                else "active"
                if self.effective
                else "fallback"
                if self.failure_reason
                else "pending"
            ),
            "hushFailureReason": self.failure_reason,
            "hushPluginVersion": self.artifact.get("version") if self.artifact else None,
            "hushPluginCommit": self.artifact.get("commit") if self.artifact else None,
            "hushSourceHashesVerified": self.artifact.get("source_hashes_verified") if self.artifact else None,
            "hushModelHashesVerified": self.artifact.get("model_hashes_verified") if self.artifact else None,
            "hushFrames": stats.get("frames", 0),
            "hushLatencyP50Ms": stats.get("p50_ms", 0.0),
            "hushLatencyP95Ms": stats.get("p95_ms", 0.0),
            "hushOverruns": stats.get("overruns", 0),
        }

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        processor = self.processor
        if processor is not None:
            try:
                close = getattr(processor, "_close", None)
                if callable(close):
                    close()
            except Exception as exc:  # noqa: BLE001 - shutdown must never fail a session
                log.warning("hush processor cleanup failed: %s", exc)
        log.info("hush session summary: %s", self.status())


def _build_processor(runtime: HushRuntime) -> Any:
    """Create one processor for this agent session, using the pinned plugin API."""
    from livekit.plugins.hush import HushNoiseSuppressor

    class InstrumentedHush(HushNoiseSuppressor):
        def __init__(self) -> None:
            super().__init__(atten_lim_db=100.0, strength=1.0)
            self._metrics_lock = threading.Lock()
            self._frames = 0
            self._overruns = 0
            self._latencies_ms: list[float] = []
            self._bypassed = False

        def _process(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
            # A live failure is terminal for this session.  Retrying the model
            # on every frame would add latency and repeatedly risk a broken
            # code path.  Once failed, preserve the raw baseline until the
            # next newly created room has a chance to initialize cleanly.
            if self._bypassed or not runtime.effective:
                return frame
            started = time.perf_counter()
            try:
                result = super()._process(frame)
            except Exception as exc:  # a live cleanup failure must leave the raw path usable
                self._bypassed = True
                runtime.mark_fallback(f"frame_processing_failed:{type(exc).__name__}")
                return frame

            elapsed_ms = (time.perf_counter() - started) * 1000.0
            frame_ms = 1000.0 * frame.samples_per_channel / frame.sample_rate
            with self._metrics_lock:
                self._frames += 1
                self._latencies_ms.append(elapsed_ms)
                if elapsed_ms > frame_ms:
                    self._overruns += 1
            return result

        def snapshot(self) -> dict[str, float | int]:
            with self._metrics_lock:
                latencies = sorted(self._latencies_ms)

            def percentile(value: float) -> float:
                if not latencies:
                    return 0.0
                index = min(len(latencies) - 1, max(0, math.ceil(len(latencies) * value) - 1))
                return round(latencies[index], 3)

            return {
                "frames": self._frames,
                "overruns": self._overruns,
                "p50_ms": percentile(0.50),
                "p95_ms": percentile(0.95),
            }

    processor = InstrumentedHush()
    if not isinstance(processor, rtc.FrameProcessor):
        raise HushContractError("Hush plugin did not create a LiveKit FrameProcessor")
    return processor


def prepare_hush_audio(requested: bool) -> HushRuntime:
    """Return a ready Hush runtime or a labelled raw-audio fallback; never raise."""
    runtime = HushRuntime(requested=requested)
    if not requested:
        return runtime
    try:
        runtime.artifact = _verify_plugin_artifact()
        runtime.processor = _build_processor(runtime)
        runtime.effective = True
        log.info("hush initialized for this new session: %s", runtime.status())
    except Exception as exc:  # noqa: BLE001 - optional feature must not block a learner
        runtime.mark_fallback(f"initialization_failed:{type(exc).__name__}")
        log.exception("hush requested but unavailable; continuing with baseline audio")
    return runtime
