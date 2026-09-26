from copy import deepcopy
import json
import unittest

from elevate_live_words import LiveWordEvidenceCollector
from elevate_turn_upload import build_turn_upload_batches, MAX_UPLOAD_BYTES


class ElevateTurnUploadTests(unittest.TestCase):
    def test_live_words_are_batched_below_the_actual_json_body_limit(self):
        collector = LiveWordEvidenceCollector("transcribe")
        turns = []
        for n in range(12):
            tokens = [f"word{n}x{i}" for i in range(120)]
            text = " ".join(tokens)
            collector.ingest({"type": "final_transcript", "alternatives": [{
                "text": text, "words": [
                    {"w": w, "start": n * 60 + i * .4, "end": n * 60 + i * .4 + .2,
                     "recognitionConfidence": .95} for i, w in enumerate(tokens)
                ],
            }]})
            turns.append({"role": "user", "text": text, "turnIndex": n})
        for turn, evidence in zip(turns, collector.for_turns(turns)):
            turn["metrics"] = {"live_word_evidence": evidence}
        before = deepcopy(turns)
        self.assertGreater(len(json.dumps({"turns": turns}).encode("utf-8")), 100 * 1024)
        batches = build_turn_upload_batches(turns, "segment")
        self.assertGreater(len(batches), 1)
        self.assertEqual([turn for batch in batches for turn in batch["turns"]], turns)
        for batch in batches:
            self.assertEqual(batch["segmentId"], "segment")
            self.assertLessEqual(len(json.dumps(batch).encode("utf-8")), MAX_UPLOAD_BYTES)
            self.assertLess(len(json.dumps(batch).encode("utf-8")), 100 * 1024)
        self.assertEqual(turns, before)

    def test_oversized_source_is_withheld_without_truncating_a_turn(self):
        turn = {"turnIndex": 4, "role": "user", "text": "Keep every committed word.",
                "metrics": {"filler_count": 2, "live_word_evidence": {
                    "provider": "transcribe", "words": [{"w": "source"}] * 10000,
                }}}
        before = deepcopy(turn)
        with self.assertLogs("spashtai-agent.elevate_turn_upload", level="WARNING"):
            batches = build_turn_upload_batches([turn])
        saved = batches[0]["turns"][0]
        self.assertEqual(saved["text"], turn["text"])
        self.assertEqual(saved["turnIndex"], 4)
        self.assertEqual(saved["metrics"]["filler_count"], 2)
        self.assertEqual(saved["metrics"]["live_word_evidence"]["reason"], "source_payload_limit")
        self.assertEqual(saved["metrics"]["live_word_evidence"]["words"], [])
        self.assertEqual(turn, before)
        self.assertNotIn("segmentId", batches[0])

    def test_json_escaping_is_included_in_the_byte_budget(self):
        turns = [{"turnIndex": i, "role": "user", "text": "\u4f60" * 2500} for i in range(10)]
        batches = build_turn_upload_batches(turns, "segment")
        self.assertGreater(len(batches), 1)
        self.assertTrue(all(len(json.dumps(b).encode("utf-8")) <= MAX_UPLOAD_BYTES for b in batches))
        self.assertEqual([turn for batch in batches for turn in batch["turns"]], turns)

    def test_mandatory_oversized_turn_is_an_explicit_error_never_truncated(self):
        turns = [{"turnIndex": 0, "role": "user", "text": "x" * MAX_UPLOAD_BYTES}]
        with self.assertRaisesRegex(ValueError, "Committed turn exceeds upload limit"):
            build_turn_upload_batches(turns)
        self.assertEqual(len(turns[0]["text"]), MAX_UPLOAD_BYTES)

    def test_empty_and_small_payloads(self):
        self.assertEqual(build_turn_upload_batches([]), [])
        turns = [{"turnIndex": 0, "role": "user", "text": "hello"}]
        self.assertEqual(build_turn_upload_batches(turns), [{"turns": turns}])


if __name__ == "__main__":
    unittest.main()
