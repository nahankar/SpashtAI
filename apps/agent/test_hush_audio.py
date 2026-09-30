"""Offline contract tests for the optional Hush boundary.

These do not require the third-party wheel. The production worker imports the
module while disabled, so a missing/broken optional dependency must never alter
the baseline session path.
"""
import unittest
import sys
import types
from unittest.mock import patch

from livekit import rtc

from hush_audio import HushRuntime, _build_processor, prepare_hush_audio
from voice_backends import VoiceBackendConfig


class HushAudioTests(unittest.TestCase):
    def test_room_metadata_defaults_to_disabled(self):
        self.assertFalse(VoiceBackendConfig.from_room_meta({}).hush_enabled)
        self.assertFalse(VoiceBackendConfig.from_room_meta({"hushEnabled": False}).hush_enabled)

    def test_room_metadata_accepts_boolean_and_legacy_true_string_only(self):
        self.assertTrue(VoiceBackendConfig.from_room_meta({"hushEnabled": True}).hush_enabled)
        self.assertTrue(VoiceBackendConfig.from_room_meta({"hushEnabled": "true"}).hush_enabled)
        self.assertFalse(VoiceBackendConfig.from_room_meta({"hushEnabled": "false"}).hush_enabled)

    def test_disabled_runtime_never_imports_or_constructs_hush(self):
        with patch("hush_audio._verify_plugin_artifact") as verify:
            runtime = prepare_hush_audio(False)
        verify.assert_not_called()
        self.assertFalse(runtime.requested)
        self.assertFalse(runtime.effective)
        self.assertIsNone(runtime.processor)
        self.assertIsNone(runtime.failure_reason)
        self.assertEqual(runtime.status()["hushState"], "disabled")

    def test_enabled_initialization_failure_is_labelled_raw_fallback(self):
        with patch("hush_audio._verify_plugin_artifact", side_effect=RuntimeError("broken model")):
            runtime = prepare_hush_audio(True)
        self.assertTrue(runtime.requested)
        self.assertFalse(runtime.effective)
        self.assertIsNone(runtime.processor)
        self.assertEqual(runtime.failure_reason, "initialization_failed:RuntimeError")
        self.assertEqual(runtime.status()["hushEffective"], False)
        self.assertEqual(runtime.status()["hushState"], "fallback")

    def test_fallback_is_terminal_and_notifies_status_once(self):
        notified = []
        runtime = HushRuntime(requested=True, effective=True, on_status_change=notified.append)

        runtime.mark_fallback("frame_processing_failed:RuntimeError")
        runtime.mark_fallback("frame_processing_failed:RuntimeError")

        self.assertFalse(runtime.effective)
        self.assertEqual(runtime.status()["hushState"], "fallback")
        self.assertEqual(notified, [runtime])

    def test_status_exposes_reviewed_artifact_verification(self):
        runtime = HushRuntime(
            requested=True,
            effective=True,
            artifact={
                "version": "0.3.3",
                "commit": "reviewed-commit",
                "source_hashes_verified": {"noise_suppressor.py": True},
                "model_hashes_verified": {"enc.onnx": True},
            },
        )

        self.assertEqual(runtime.status()["hushState"], "active")
        self.assertEqual(runtime.status()["hushSourceHashesVerified"], {"noise_suppressor.py": True})
        self.assertEqual(runtime.status()["hushModelHashesVerified"], {"enc.onnx": True})

    def test_frame_failure_bypasses_hush_for_the_rest_of_the_session(self):
        calls = []

        class FailingSuppressor(rtc.FrameProcessor):
            def __init__(self, **_kwargs):
                super().__init__()

            @property
            def enabled(self):
                return True

            def _close(self):
                pass

            def _process(self, _frame):
                calls.append(_frame)
                raise RuntimeError("model failure")

        fake_hush = types.ModuleType("livekit.plugins.hush")
        fake_hush.HushNoiseSuppressor = FailingSuppressor
        runtime = HushRuntime(requested=True, effective=True)
        frame = rtc.AudioFrame(b"\0" * 320, 16000, 1, 160)

        with patch.dict(sys.modules, {"livekit.plugins.hush": fake_hush}):
            processor = _build_processor(runtime)
            self.assertIs(processor._process(frame), frame)
            self.assertIs(processor._process(frame), frame)

        self.assertEqual(len(calls), 1)
        self.assertFalse(runtime.effective)
        self.assertEqual(runtime.status()["hushState"], "fallback")


if __name__ == "__main__":
    unittest.main()
