"""Offline integration of the actual agent node with public LiveKit events."""

import os
import unittest
from unittest.mock import Mock, patch

with patch.dict(os.environ, {"SIGNAL_API_INPROCESS": "0"}):
    import main

from livekit.agents import stt
from livekit.agents.types import TimedString


def final():
    return stt.SpeechEvent(
        type=stt.SpeechEventType.FINAL_TRANSCRIPT,
        alternatives=[stt.SpeechData(
            language="en-US", text="hello world", start_time=10, end_time=12,
            words=[TimedString("hello", 10, 11, confidence=0.95),
                   TimedString("world", 11, 12, confidence=0.94)],
        )],
    )


class LiveAgentWiringTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.pace = Mock()
        self.agent = main.CoachingAgent(
            instructions="Offline test", pacing_tracker=self.pace,
            voice_backend="pipeline-bedrock", stt_provider="transcribe",
        )

    async def test_public_word_events_pass_through_and_remain_source_only(self):
        events = [stt.SpeechEvent(type=stt.SpeechEventType.START_OF_SPEECH), final()]

        async def stream(*_args):
            for event in events:
                yield event

        with patch.object(main.Agent.default, "stt_node", stream):
            delivered = [event async for event in self.agent.stt_node(None, None)]
        self.assertEqual(delivered, events)
        self.pace.ingest_measured_final.assert_called_once()
        self.assertEqual(self.pace.ingest_measured_final.call_args.kwargs["pace_source"], "word_timestamps")
        evidence = self.agent._live_word_evidence.for_turns([
            {"role": "assistant", "text": "Please continue."},
            {"role": "user", "text": "Hello world."},
        ])
        self.assertEqual(evidence[0]["reason"], "non_user_turn")
        self.assertEqual(evidence[1]["state"], "source_only")
        self.assertEqual(evidence[1]["words"][0]["start"], 10)
        self.assertIsNone(evidence[1]["mapping"])

    async def test_new_node_invocation_partitions_reconnected_source_clocks(self):
        event = final()

        async def stream(*_args):
            yield event

        with patch.object(main.Agent.default, "stt_node", stream):
            for _ in range(2):
                self.assertEqual(
                    [item async for item in self.agent.stt_node(None, None)], [event]
                )
        turns = [{"role": "user", "text": "hello world"}] * 2
        evidence = self.agent._live_word_evidence.for_turns(turns)
        self.assertEqual([item["state"] for item in evidence], ["source_only"] * 2)
        combined = self.agent._live_word_evidence.for_turns([
            {"role": "user", "text": "hello world hello world"},
        ])
        self.assertEqual(combined[0]["reason"], "stream_epoch_boundary")

    async def test_capture_failure_cannot_drop_live_text_or_pacing(self):
        event = final()

        async def stream(*_args):
            yield event

        with patch.object(main.Agent.default, "stt_node", stream), \
                patch.object(self.agent._live_word_evidence, "ingest", side_effect=ValueError()), \
                self.assertLogs(main.logger, level="WARNING"):
            delivered = [item async for item in self.agent.stt_node(None, None)]
        self.assertEqual(delivered, [event])
        self.pace.ingest_measured_final.assert_called_once()

    async def test_no_timing_backend_keeps_voice_path_without_inventing_evidence(self):
        event = stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language="en-US", text="hello world")],
        )

        async def stream(*_args):
            yield event

        agent = main.CoachingAgent(instructions="Offline test", pacing_tracker=Mock(),
                                   voice_backend="pipeline-premium", stt_provider="whisper")
        with patch.object(main.Agent.default, "stt_node", stream):
            self.assertEqual([item async for item in agent.stt_node(None, None)], [event])
        evidence = agent._live_word_evidence.for_turns([{"role": "user", "text": "hello world"}])[0]
        self.assertEqual(evidence["state"], "unavailable")
        self.assertEqual(evidence["words"], [])


if __name__ == "__main__":
    unittest.main()
