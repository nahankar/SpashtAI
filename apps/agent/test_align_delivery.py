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

    def test_pulls_a_boundary_touch_forward_and_still_rejects_a_real_overlap(self):
        words = [dict(w) for w in self.words]
        words[1]["start"] = self.words[0]["end"] - 0.02
        result = validate_result({"words": words}, self.tokens, 10)
        self.assertEqual(result[0]["words"][1]["start"], self.words[0]["end"])

        words[1]["start"] = self.words[0]["end"] - 0.2
        with self.assertRaises(ValueError):
            validate_result({"words": words}, self.tokens, 10)

    def test_joins_a_hyphenated_word_gentle_split_in_two(self):
        text, tokens = build_transcript([{"id": "a", "text": "An industry-relevant point."}])
        hyphen = next(i for i, item in enumerate(tokens) if "-" in item[3])
        lo, hi = tokens[hyphen][0], tokens[hyphen][1]
        words = []
        clock = 0.2
        for i, (start, end, _, raw) in enumerate(tokens):
            if i == hyphen:
                words.append({
                    "case": "success", "word": "industry",
                    "startOffset": lo, "endOffset": lo + 8,
                    "start": clock, "end": clock + 0.4,
                })
                clock += 0.4
                words.append({
                    "case": "success", "word": "relevant",
                    "startOffset": lo + 9, "endOffset": hi,
                    "start": clock, "end": clock + 0.4,
                })
            else:
                words.append({
                    "case": "success", "word": raw,
                    "startOffset": start, "endOffset": end,
                    "start": clock, "end": clock + 0.3,
                })
            clock += 0.5
        result = validate_result({"words": words}, tokens, 10)
        aligned = result[0]["words"][hyphen]
        self.assertEqual(aligned["w"], "industry-relevant")
        self.assertEqual(aligned["start"], words[hyphen]["start"])
        self.assertGreater(aligned["end"], aligned["start"])

    def test_ignores_a_blip_inside_the_previous_word(self):
        words = [dict(w) for w in self.words]
        words[1]["start"] = 0.05
        words[1]["end"] = 0.06
        result = validate_result({"words": words}, self.tokens, 10)
        self.assertEqual([t["id"] for t in result], ["b"])

        words[1]["end"] = 0.3
        with self.assertRaises(ValueError):
            validate_result({"words": words}, self.tokens, 10)

    def test_no_synthetic_word_fill_for_empty_alignment(self):
        self.assertEqual(validate_result({"words": []}, self.tokens, 10), [])

    def test_one_interior_miss_keeps_the_surrounding_words(self):
        words_text = "one two three four five six seven eight nine ten eleven twelve"
        text, tokens = build_transcript([{"id": "long", "text": words_text}])
        aligned = []
        for index, (start, end, _, raw) in enumerate(tokens):
            if raw == "six":
                aligned.append({"case": "not-found-in-audio", "word": raw,
                                "startOffset": start, "endOffset": end})
                continue
            aligned.append({"case": "success", "word": raw, "startOffset": start,
                            "endOffset": end, "start": index * 0.5, "end": index * 0.5 + 0.4})
        result = validate_result({"words": aligned}, tokens, 20)
        self.assertEqual(len(result), 1)
        kept = result[0]["words"]
        self.assertEqual(len(kept), 11)
        self.assertNotIn("six", [word["w"] for word in kept])
        self.assertEqual(kept[4]["tokenIndex"], 4)
        self.assertEqual(kept[5]["tokenIndex"], 6)
        self.assertEqual(kept[0]["tokenIndex"], 0)
        self.assertEqual(kept[-1]["tokenIndex"], 11)


if __name__ == "__main__":
    unittest.main()
