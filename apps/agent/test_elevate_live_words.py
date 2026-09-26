"""Offline tests: python -m unittest discover -s apps/agent -p test_elevate_live_words.py."""

from copy import deepcopy
from importlib.metadata import PackageNotFoundError, version
from itertools import product
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import elevate_live_words as module
from elevate_live_words import LiveWordEvidenceCollector

try:
    version("livekit-agents")
except PackageNotFoundError:
    SDK_INSTALLED = False
else:
    SDK_INSTALLED = True
    from livekit.agents import Agent, stt
    from livekit.agents.types import TimedString
    from livekit.agents.voice.events import UserInputTranscribedEvent

try:
    version("livekit-plugins-aws")
except PackageNotFoundError:
    AWS_INSTALLED = False
else:
    AWS_INSTALLED = True


def word(text, start, end, confidence=None):
    value = {"w": text, "start": start, "end": end}
    if confidence is not None:
        value["recognitionConfidence"] = confidence
    return value


def final(text, words=None, **fields):
    return {
        "type": "final_transcript",
        "alternatives": [{"text": text, "words": words}],
        **fields,
    }


def timed_final(text, start=0.0, **fields):
    return final(
        text,
        [word(token, start + i, start + i + 0.5) for i, token in enumerate(text.split())],
        **fields,
    )


def turn(text, **fields):
    return {"text": text, "role": "user", **fields}


class LiveWordEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.collector = LiveWordEvidenceCollector("transcribe")

    def evidence(self, text):
        return self.collector.for_turns([turn(text)])[0]

    def test_source_only_shape_and_no_invented_clock_or_ids(self):
        event = final("Hello world", [word("Hello", 0.0, 0.4, 0.0), word("world", 0.5, 0.9, 0.97)])
        event["speech_start_time"] = 1700000000
        event["request_id"] = "not-a-result-or-stream-id"
        self.assertTrue(self.collector.ingest(event))
        turns = [turn("Hello world", startedAt=1700000000000, arbitrary={"keep": True})]
        before = deepcopy(turns)
        evidence = self.collector.for_turns(turns)[0]
        self.assertEqual(evidence, {
            "version": "elevate-live-words-v1", "provider": "transcribe",
            "state": "source_only", "reason": "unanchored_stt_stream", "clock": "stt_stream",
            "words": event["alternatives"][0]["words"], "mapping": None,
        })
        self.assertEqual(json.loads(json.dumps(evidence, allow_nan=False)), evidence)
        self.assertEqual(turns, before)

    def test_only_finals_are_accepted_and_partial_does_not_reserve_result_id(self):
        for kind in ["interim_transcript", "preflight_transcript", "start_of_speech",
                     "end_of_speech", "recognition_usage", "unknown"]:
            with self.subTest(kind=kind):
                event = timed_final("hello", result_id="r1")
                event["type"] = kind
                self.assertFalse(self.collector.ingest(event))
        self.assertFalse(self.collector.ingest({"text": "hello", "is_final": "true"}))
        self.assertFalse(self.collector.ingest(final("hello", is_partial=True)))
        self.assertFalse(self.collector.ingest(final("hello", is_final=False)))
        self.assertTrue(self.collector.ingest(timed_final("hello", result_id="r1")))

    def test_duplicate_final_and_copied_event_are_ignored(self):
        event = timed_final("hello", result_id="r1")
        self.assertTrue(self.collector.ingest(event))
        self.assertFalse(self.collector.ingest(event))
        self.assertFalse(self.collector.ingest(deepcopy(event)))
        self.assertEqual(len(self.evidence("hello")["words"]), 1)

    def test_distinct_result_ids_and_distinct_times_are_not_deduplicated(self):
        for event in [timed_final("yes", result_id="one"),
                      timed_final("yes", result_id="two"),
                      timed_final("yes", start=2)]:
            self.assertTrue(self.collector.ingest(event))
        result = self.collector.for_turns([turn("yes"), turn("yes"), turn("yes")])
        self.assertEqual([e["state"] for e in result], ["source_only"] * 3)
        self.assertEqual([e["words"][0]["start"] for e in result], [0, 0, 2])

    def test_conflicting_final_identity_fails_closed_and_logs(self):
        self.collector.ingest(timed_final("one", result_id="same"))
        with self.assertLogs(module.logger, level="WARNING"):
            self.assertFalse(self.collector.ingest(timed_final("two", result_id="same")))
        self.assertEqual(self.evidence("one")["reason"], "conflicting_final_result")

    def test_identity_is_traceable_only_and_results_aggregate(self):
        self.collector.begin_stream("aws-session")
        self.collector.ingest(timed_final("one", result_id="r1"))
        self.collector.ingest(timed_final("two", start=2, resultId="r2"))
        evidence = self.evidence("one two")
        self.assertEqual(evidence["streamId"], "aws-session")
        self.assertEqual(evidence["resultIds"], ["r1", "r2"])

    def test_identical_callbacks_after_explicit_reconnect_are_new(self):
        event = timed_final("yes", result_id="reused")
        self.collector.begin_stream("reused-session")
        self.collector.ingest(event)
        self.collector.begin_stream("reused-session")
        self.assertTrue(self.collector.ingest(event))
        self.assertFalse(self.collector.ingest(event))
        result = self.collector.for_turns([turn("yes"), turn("yes")])
        self.assertEqual([e["state"] for e in result], ["source_only", "source_only"])
        self.assertEqual(self.evidence("yes yes")["reason"], "stream_epoch_boundary")

    def test_anonymous_explicit_reconnect_never_fabricates_stream_id(self):
        self.collector.ingest(timed_final("first"))
        self.collector.begin_stream()
        self.collector.ingest(timed_final("next"))
        result = self.collector.for_turns([turn("first"), turn("next")])
        self.assertTrue(all("streamId" not in e for e in result))
        self.assertTrue(all(e["state"] == "source_only" for e in result))
        self.assertEqual(self.evidence("first next")["reason"], "stream_epoch_boundary")

    def test_stream_identity_and_epoch_changes_partition_evidence(self):
        for fields in [
            ({"stream_id": "a"}, {"stream_id": "b"}),
            ({"stream_epoch": 0}, {"stream_epoch": 1}),
        ]:
            with self.subTest(fields=fields):
                collector = LiveWordEvidenceCollector("transcribe")
                first = timed_final("first", result_id="r", **fields[0])
                collector.ingest(first)
                collector.ingest(timed_final("next", result_id="r", **fields[1]))
                self.assertFalse(collector.ingest(deepcopy(first)))
                self.assertEqual(
                    collector.for_turns([turn("first next")])[0]["reason"],
                    "stream_epoch_boundary",
                )

    def test_regressing_source_time_partitions_without_shifting_times(self):
        self.collector.ingest(timed_final("first", start=10))
        self.collector.ingest(timed_final("next", start=1))
        evidence = self.collector.for_turns([turn("first"), turn("next")])
        self.assertEqual([e["words"][0]["start"] for e in evidence], [10, 1])
        self.assertEqual(self.evidence("first next")["reason"], "stream_epoch_boundary")

    def test_speech_boundaries_do_not_reset_dedup(self):
        event = timed_final("first")
        self.collector.ingest(event)
        for kind in ("start_of_speech", "end_of_speech"):
            self.assertFalse(self.collector.ingest({"type": kind}))
        self.assertFalse(self.collector.ingest(event))

    def test_repeated_phrases_are_assigned_by_global_order(self):
        self.collector.ingest(timed_final("go now", start=0))
        self.collector.ingest(timed_final("go now", start=5))
        result = self.collector.for_turns([turn("go now"), turn("go now")])
        self.assertEqual([e["words"][0]["start"] for e in result], [0, 5])
        self.assertEqual(self.evidence("go now")["reason"], "ambiguous_turn_text")

    def test_missing_repeated_fragment_does_not_borrow_from_other_turn(self):
        self.collector.ingest(timed_final("yes finish"))
        result = self.collector.for_turns([
            turn("yes"), turn("missing"), turn("yes"), turn("finish"),
        ])
        self.assertEqual([e["reason"] for e in result], [
            "ambiguous_turn_text", "turn_text_not_matched",
            "ambiguous_turn_text", "unanchored_stt_stream",
        ])
        self.assertEqual(result[-1]["words"][0]["w"], "finish")

    def test_missing_fragment_inside_turn_does_not_drift_later_turns(self):
        self.collector.ingest(timed_final("first fragment"))
        self.collector.ingest(timed_final("later exact", start=5))
        result = self.collector.for_turns([
            turn("first missing fragment"),
            turn("later exact"),
        ])
        self.assertEqual(result[0]["words"], [])
        self.assertEqual([w["w"] for w in result[1]["words"]], ["later", "exact"])

    def test_exact_split_and_merged_final_fragments(self):
        self.collector.ingest(timed_final("one two", result_id="a"))
        self.collector.ingest(timed_final("three four", start=3, result_id="b"))
        result = self.collector.for_turns([turn("one"), turn("two three"), turn("four")])
        self.assertEqual([[w["w"] for w in e["words"]] for e in result],
                         [["one"], ["two", "three"], ["four"]])
        self.assertEqual(result[1]["resultIds"], ["a", "b"])

    def test_lexical_normalization_not_fuzzy_substitution(self):
        self.collector.ingest(final(
            "It's caf\u00e9 time!", [word("It's", 0, 0.4), word("caf\u00e9", 0.5, 0.9),
                                   word("time!", 1, 1.4)]
        ))
        self.assertEqual(self.evidence("IT\u2019S CAF\u00c9 TIME.")["state"], "source_only")
        self.assertEqual(self.evidence("it is coffee time")["words"], [])

    def test_missing_word_preserves_only_uniquely_mapped_intervals(self):
        self.collector.ingest(final("one missing two", [word("one", 0, 0.4), word("two", 2, 2.4)]))
        evidence = self.evidence("one missing two")
        self.assertEqual(evidence["reason"], "incomplete_word_timestamps")
        self.assertEqual([w["w"] for w in evidence["words"]], ["one", "two"])
        self.assertEqual(evidence["words"][1]["start"], 2)

    def test_missing_repeated_word_is_ambiguous_not_greedily_assigned(self):
        self.collector.ingest(final("yes yes end", [word("yes", 1, 1.4), word("end", 2, 2.4)]))
        evidence = self.evidence("yes yes end")
        self.assertEqual(evidence["reason"], "ambiguous_word_text")
        self.assertEqual([w["w"] for w in evidence["words"]], ["end"])

    def test_word_text_mismatch_is_not_promoted(self):
        self.collector.ingest(final("the cat", [word("the", 0, 0.4), word("dog", 1, 1.4)]))
        self.assertEqual(self.evidence("the cat")["reason"], "word_text_mismatch")
        self.assertEqual(self.evidence("the cat")["words"], [])

    def test_timed_chunks_are_not_split_into_fake_words(self):
        self.collector.ingest(final("one two", [word("one two", 0, 2)]))
        evidence = self.evidence("one two")
        self.assertEqual(evidence["reason"], "non_word_timing")
        self.assertEqual(evidence["words"], [])

    def test_invalid_intervals_are_omitted_but_not_interpolated(self):
        for start, end in [(-1, 0), (1, 1), (2, 1), (float("nan"), 2),
                           (0, float("inf")), (None, 1), ("0", 1), (False, 1),
                           (10**1000, 2)]:
            with self.subTest(start=start, end=end):
                collector = LiveWordEvidenceCollector("transcribe")
                collector.ingest(final("bad good", [word("bad", start, end), word("good", 3, 4)]))
                evidence = collector.for_turns([turn("bad good")])[0]
                self.assertEqual(evidence["reason"], "invalid_word_intervals")
                self.assertEqual(evidence["words"], [word("good", 3, 4)])
                json.dumps(evidence, allow_nan=False)

    def test_overlap_and_out_of_segment_intervals_are_omitted(self):
        event = final("one two three four", [
            word("one", 1, 2), word("two", 1.5, 2.5),
            word("three", 2, 3), word("four", 4, 5),
        ])
        event["alternatives"][0].update(start_time=1, end_time=3)
        self.collector.ingest(event)
        evidence = self.evidence("one two three four")
        self.assertEqual([w["w"] for w in evidence["words"]], ["one", "three"])
        self.assertEqual(evidence["reason"], "invalid_word_intervals")

    def test_confidence_is_word_specific_optional_and_finite(self):
        for confidence in [None, float("nan"), float("inf"), -0.1, 1.1, True, "0.5"]:
            with self.subTest(confidence=confidence):
                collector = LiveWordEvidenceCollector("transcribe")
                event = final("one", [word("one", 0, 1, confidence)])
                event["alternatives"][0]["confidence"] = 0.99
                collector.ingest(event)
                self.assertNotIn(
                    "recognitionConfidence", collector.for_turns([turn("one")])[0]["words"][0]
                )

    def test_punctuation_without_times_does_not_degrade_word_evidence(self):
        self.collector.ingest(final("hello!", [word("hello", 0, 1), {"w": "!"}]))
        self.assertEqual(self.evidence("hello")["reason"], "unanchored_stt_stream")

    def test_only_primary_alternative_is_used(self):
        event = timed_final("primary")
        event["alternatives"].append(timed_final("secondary")["alternatives"][0])
        self.collector.ingest(event)
        self.assertEqual(self.evidence("secondary")["words"], [])
        self.assertEqual(self.evidence("primary")["state"], "source_only")

    def test_sanitized_attribute_objects_work_without_sdk(self):
        event = SimpleNamespace(
            type="final_transcript", stream_id="s", result_id="r",
            alternatives=[SimpleNamespace(
                text="one", words=[SimpleNamespace(
                    text="one", start_time=2, end_time=3, confidence=0.9,
                )],
            )],
        )
        self.collector.ingest(event)
        self.assertEqual(self.evidence("one")["words"], [word("one", 2, 3, 0.9)])

    def test_non_timed_providers_keep_lexical_slots_without_faking_words(self):
        collector = LiveWordEvidenceCollector("nova-sonic")
        collector.ingest({"is_final": True, "transcript": "first"})
        collector.ingest(final("next"))
        evidence = collector.for_turns([turn("first"), turn("next")])
        self.assertEqual([e["state"] for e in evidence], ["unavailable", "unavailable"])
        self.assertEqual([e["reason"] for e in evidence], ["word_timestamps_unavailable"] * 2)
        self.assertTrue(all(e["provider"] == "nova-sonic" and e["mapping"] is None for e in evidence))

    def test_segment_timestamps_alone_never_become_word_times(self):
        event = final("one two")
        event["alternatives"][0].update(start_time=1, end_time=5, confidence=0.9)
        self.collector.ingest(event)
        evidence = self.evidence("one two")
        self.assertEqual(evidence["words"], [])
        self.assertEqual(evidence["reason"], "word_timestamps_unavailable")

    def test_return_values_are_aligned_fresh_and_inputs_not_mutated(self):
        event = timed_final("one two")
        original = deepcopy(event)
        self.collector.ingest(event)
        turns = [turn("coach", role="assistant"), turn("one"), turn(""), turn("two")]
        evidence = self.collector.for_turns(turns)
        self.assertEqual(len(evidence), len(turns))
        self.assertEqual(evidence[0]["reason"], "non_user_turn")
        self.assertEqual(evidence[2]["reason"], "invalid_turn_text")
        evidence[1]["words"][0]["start"] = 999
        event["alternatives"][0]["words"][0]["w"] = "mutated"
        self.assertEqual(self.evidence("one two")["words"], original["alternatives"][0]["words"])
        self.assertEqual(self.collector.for_turns([]), [])

    def test_no_events_and_malformed_finals_are_explicit(self):
        self.assertEqual(self.evidence("one")["reason"], "no_final_stt_events")
        for event in [{"type": "final_transcript", "alternatives": []},
                      final(""), final("one", words="not-a-list"),
                      final("one", stream_id=123), final("one", stream_epoch=True)]:
            with self.subTest(event=event):
                collector = LiveWordEvidenceCollector("transcribe")
                with self.assertLogs(module.logger, level="WARNING"):
                    self.assertFalse(collector.ingest(event))
                self.assertEqual(collector.for_turns([turn("one")])[0]["state"], "unavailable")

    def test_resource_limits_fail_closed_without_silent_eviction(self):
        with patch.object(module, "MAX_EVENTS", 1):
            self.collector.ingest(timed_final("one"))
            with self.assertLogs(module.logger, level="WARNING"):
                self.assertFalse(self.collector.ingest(timed_final("two", start=2)))
            self.assertEqual(self.evidence("one")["reason"], "evidence_limit_exceeded")
            self.assertFalse(self.collector.ingest(timed_final("three")))
        for limit, value, event in [
            ("MAX_SOURCE_TOKENS", 1, timed_final("one two")),
            ("MAX_EVENT_WORDS", 1, timed_final("one two")),
            ("MAX_TEXT_CHARS", 2, timed_final("one")),
            ("MAX_WORD_CHARS", 2, timed_final("one")),
        ]:
            with self.subTest(limit=limit), patch.object(module, limit, value):
                collector = LiveWordEvidenceCollector("transcribe")
                with self.assertLogs(module.logger, level="WARNING"):
                    self.assertFalse(collector.ingest(event))

    def test_alignment_limits_are_explicit(self):
        self.collector.ingest(timed_final("one two"))
        with patch.object(module, "MAX_ALIGNMENT_CELLS", 2):
            self.assertEqual(self.evidence("one two")["reason"], "alignment_limit_exceeded")
        with patch.object(module, "MAX_TURNS", 1):
            evidence = self.collector.for_turns([turn("one"), turn("two")])
            self.assertTrue(all(e["reason"] == "alignment_limit_exceeded" for e in evidence))

    def test_constructor_validates_provider(self):
        for provider in ("", "   ", None, "x" * 257):
            with self.subTest(provider=provider), self.assertRaises(ValueError):
                LiveWordEvidenceCollector(provider)

    def test_short_repeated_alignments_match_exhaustive_oracle(self):
        def oracle(source, queries):
            paths = []

            def walk(index, cursor, score, assignments):
                if index == len(queries):
                    paths.append((score, assignments))
                    return
                walk(index + 1, cursor, score, assignments + [None])
                query = queries[index]
                for start in range(cursor, len(source)):
                    end = start + len(query)
                    if source[start:end] == query:
                        walk(index + 1, end, score + len(query), assignments + [(start, end)])

            walk(0, 0, 0, [])
            best = max(score for score, _ in paths)
            optimal = [assignment for score, assignment in paths if score == best]
            result = []
            for index in range(len(queries)):
                choices = {assignment[index] for assignment in optimal}
                result.append(next(iter(choices)) if len(choices) == 1 else None)
            return result

        phrases = [("a",), ("b",), ("a", "b"), ("a", "a")]
        for size in range(1, 5):
            for source in product(("a", "b"), repeat=size):
                collector = LiveWordEvidenceCollector("test")
                collector.ingest(timed_final(" ".join(source)))
                for queries in product(phrases, repeat=3):
                    expected = oracle(source, queries)
                    actual = collector.for_turns([turn(" ".join(query)) for query in queries])
                    for span, evidence in zip(expected, actual):
                        if span is None:
                            self.assertEqual(evidence["words"], [], (source, queries))
                        else:
                            self.assertEqual(
                                [w["start"] for w in evidence["words"]],
                                list(range(*span)), (source, queries),
                            )


@unittest.skipUnless(SDK_INSTALLED, "optional pinned LiveKit SDK is not installed")
class LiveKitPublicObjectTests(unittest.TestCase):
    def test_real_speech_event_and_timed_strings(self):
        event = stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            request_id="request-is-not-result",
            alternatives=[stt.SpeechData(
                language="en-US", text="hello world", start_time=10, end_time=11,
                confidence=0.8,
                words=[TimedString("hello", 10, 10.4, confidence=0.0, start_time_offset=10),
                       TimedString("world", 10.5, 11, start_time_offset=10)],
            )],
        )
        collector = LiveWordEvidenceCollector("transcribe")
        self.assertTrue(collector.ingest(event))
        self.assertFalse(collector.ingest(deepcopy(event)))
        evidence = collector.for_turns([turn("hello world")])[0]
        self.assertEqual(evidence["words"], [word("hello", 10, 10.4), word("world", 10.5, 11)])
        self.assertNotIn("streamId", evidence)
        self.assertNotIn("resultIds", evidence)
        json.dumps(evidence, allow_nan=False)

    def test_sdk_offset_changes_are_epochs_not_additional_offsets(self):
        collector = LiveWordEvidenceCollector("transcribe")
        for text, offset in [("first", 10), ("next", 20)]:
            collector.ingest(stt.SpeechEvent(
                type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                alternatives=[stt.SpeechData(
                    language="en", text=text,
                    words=[TimedString(text, offset, offset + 1, start_time_offset=offset)],
                )],
            ))
        result = collector.for_turns([turn("first"), turn("next")])
        self.assertEqual([e["words"][0]["start"] for e in result], [10, 20])
        self.assertEqual(collector.for_turns([turn("first next")])[0]["reason"],
                         "stream_epoch_boundary")

    def test_sdk_confidence_default_zero_is_unknown_not_recognition_evidence(self):
        collector = LiveWordEvidenceCollector("transcribe")
        collector.ingest(stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language="en", text="one two", words=[
                TimedString("one", 0, 1, confidence=0),
                TimedString("two", 1, 2, confidence=0.92),
            ])],
        ))
        words = collector.for_turns([turn("one two")])[0]["words"]
        self.assertNotIn("recognitionConfidence", words[0])
        self.assertEqual(words[1]["recognitionConfidence"], 0.92)

    def test_sdk_not_given_timing_is_unavailable(self):
        collector = LiveWordEvidenceCollector("whisper")
        collector.ingest(stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language="en", text="hello", words=[TimedString("hello")])],
        ))
        self.assertEqual(collector.for_turns([turn("hello")])[0]["words"], [])

    def test_real_text_only_session_callback_cannot_recover_words(self):
        collector = LiveWordEvidenceCollector("nova-sonic")
        self.assertFalse(collector.ingest(UserInputTranscribedEvent(transcript="hello", is_final=False)))
        self.assertTrue(collector.ingest(UserInputTranscribedEvent(transcript="hello", is_final=True)))
        self.assertEqual(collector.for_turns([turn("hello")])[0]["reason"],
                         "word_timestamps_unavailable")

    @unittest.skipUnless(AWS_INSTALLED, "optional AWS plugin is not installed")
    def test_pinned_public_aws_capabilities_without_network(self):
        from livekit.plugins import aws

        self.assertEqual(version("livekit-agents"), "1.5.8")
        self.assertEqual(version("livekit-plugins-aws"), "1.5.8")
        self.assertTrue(callable(Agent.default.stt_node))
        provider = aws.STT(region="us-east-1", session_id="offline-capability-test")
        self.assertEqual(provider.capabilities.aligned_transcript, "word")
        self.assertTrue(provider.capabilities.streaming)
        self.assertFalse(provider.capabilities.offline_recognize)


if __name__ == "__main__":
    unittest.main()
