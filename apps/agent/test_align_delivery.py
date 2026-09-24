import unittest

from align_delivery import build_transcript, validate_result


class DeliveryAlignmentTest(unittest.TestCase):
    def setUp(self):
        self.turns = [{"id": "a", "text": "A clear point."},
                      {"id": "b", "text": "Then another point."}]
        self.text, self.tokens = build_transcript(self.turns)
        self.words = [{"case": "success", "word": text.strip("."),
                       "startOffset": a, "endOffset": b - (1 if text.endswith(".") else 0),
                       "start": i * 0.6, "end": i * 0.6 + 0.4}
                      for i, (a, b, _, text) in enumerate(self.tokens)]

    def test_keeps_punctuation_and_turn_identity_and_real_gaps(self):
        result = validate_result({"words": self.words}, self.tokens, 10)
        self.assertEqual([t["id"] for t in result], ["a", "b"])
        self.assertEqual(result[0]["words"][-1]["w"], "point.")
        self.assertEqual(result[0]["words"][1]["start"], 0.6)
        self.assertEqual(result[0]["words"][0]["timingOrigin"], "forced_alignment")

    def test_missing_word_excludes_whole_turn_without_shifting_next(self):
        self.words[1] = {"case": "not-found-in-audio"}
        result = validate_result({"words": self.words}, self.tokens, 10)
        self.assertEqual([t["id"] for t in result], ["b"])

    def test_rejects_out_of_bounds_nonfinite_overlap_and_missing_offsets(self):
        for field, value in [("start", float("nan")), ("end", 11), ("start", -1),
                             ("endOffset", None), ("word", "different")]:
            with self.subTest(field=field, value=value):
                words = [dict(w) for w in self.words]
                words[0][field] = value
                with self.assertRaises(ValueError):
                    validate_result({"words": words}, self.tokens, 10)
        words = [dict(w) for w in self.words]
        words[1]["start"] = 0.1
        with self.assertRaises(ValueError):
            validate_result({"words": words}, self.tokens, 10)

    def test_no_synthetic_word_fill_for_empty_alignment(self):
        self.assertEqual(validate_result({"words": []}, self.tokens, 10), [])


if __name__ == "__main__":
    unittest.main()
