import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from reprocess_session import reprocess_session


class _Collector:
    instance = None

    def __init__(self, _session_id):
        _Collector.instance = self
        self.user_transcript = ""
        self.conversation_turns = []
        self.delivery_transcript_seen = None
        self.content_transcript_seen = None
        self.session_metrics = SimpleNamespace(
            delivery_metrics=None,
            content_metrics=None,
        )

    async def _analyze_delivery(self, _audio_path, _alignments):
        self.delivery_transcript_seen = self.user_transcript

    async def _analyze_content(self):
        self.content_transcript_seen = self.user_transcript

    async def _generate_insights(self):
        return None

    async def save_to_database(self, **_kwargs):
        return True


class ReprocessTranscriptSeparationTest(unittest.IsolatedAsyncioTestCase):
    async def test_partial_audio_alignment_never_replaces_full_content_text(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio = Path(temp_dir) / "merged.webm"
            audio.write_bytes(b"audio")
            with patch("reprocess_session.AdvancedMetricsCollector", _Collector):
                result = await reprocess_session(
                    "session-resumed",
                    str(audio),
                    "first segment missing middle final segment",
                    "",
                    "first segment final segment",
                    "audio-signature-v2",
                )

        self.assertTrue(result["success"])
        self.assertEqual(
            _Collector.instance.delivery_transcript_seen,
            "first segment final segment",
        )
        self.assertEqual(
            _Collector.instance.content_transcript_seen,
            "first segment missing middle final segment",
        )
        self.assertEqual(
            _Collector.instance.audio_input_signature,
            "audio-signature-v2",
        )

    async def test_missing_committed_turns_skip_partial_audio_alignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio = Path(temp_dir) / "partial.webm"
            audio.write_bytes(b"audio")
            with patch("reprocess_session.AdvancedMetricsCollector", _Collector):
                result = await reprocess_session(
                    "session-missing-turns",
                    str(audio),
                    "full session content remains available",
                    "",
                    "",
                )

        self.assertTrue(result["success"])
        self.assertEqual(_Collector.instance.delivery_transcript_seen, "")
        self.assertEqual(
            _Collector.instance.content_transcript_seen,
            "full session content remains available",
        )


if __name__ == "__main__":
    unittest.main()
