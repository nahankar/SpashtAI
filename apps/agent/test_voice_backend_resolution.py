"""Backend-resolution tests for optional pipeline-only audio features."""
import unittest
from unittest.mock import Mock, patch

from voice_backends import VoiceBackendConfig, build_session


class VoiceBackendResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_pipeline_bedrock_health_fallback_reports_nova_sonic_effective_backend(self):
        cfg = VoiceBackendConfig(backend="pipeline-bedrock", stt_provider="whisper")
        nova_session = Mock(name="nova-session")

        async def unhealthy(_cfg):
            return False, {"stt": False, "tts": True}

        with patch("voice_backends._pipeline_bedrock_health", unhealthy), patch(
            "voice_backends._build_nova_sonic", return_value=nova_session
        ):
            result = await build_session(cfg)

        self.assertIs(result.session, nova_session)
        self.assertEqual(result.effective_backend, "nova-sonic")
        self.assertEqual(result.fallback_reason, "pipeline_bedrock_health_failed")

    async def test_healthy_pipeline_bedrock_reports_its_effective_backend(self):
        cfg = VoiceBackendConfig(backend="pipeline-bedrock", stt_provider="transcribe")
        pipeline_session = Mock(name="pipeline-session")

        async def healthy(_cfg):
            return True, {"stt": True, "tts": True}

        with patch("voice_backends._pipeline_bedrock_health", healthy), patch(
            "voice_backends._build_pipeline_bedrock", return_value=pipeline_session
        ):
            result = await build_session(cfg)

        self.assertIs(result.session, pipeline_session)
        self.assertEqual(result.effective_backend, "pipeline-bedrock")
        self.assertIsNone(result.fallback_reason)


if __name__ == "__main__":
    unittest.main()
