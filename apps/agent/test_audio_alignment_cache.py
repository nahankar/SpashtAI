import tempfile
import unittest
import wave
from pathlib import Path

from audio_processor import AudioProcessor, GentleAligner, WordAlignment


def _write_silence(path: Path) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\0\0" * 160)


class GentleAlignmentCacheTest(unittest.TestCase):
    def test_exact_audio_and_transcript_reuse_cached_alignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "speech.wav"
            _write_silence(audio)

            aligner = GentleAligner()
            aligner.cache_dir = root / "cache"
            cache_path = aligner._cache_path(str(audio), "hello world")
            expected = [
                WordAlignment(word="hello", start=0.0, end=0.2, confidence=1.0),
                WordAlignment(word="world", start=0.3, end=0.5, confidence=1.0),
            ]

            aligner._write_cached_alignment(cache_path, expected)

            self.assertEqual(aligner._read_cached_alignment(cache_path), expected)

    def test_changed_transcript_or_audio_gets_a_different_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "speech.wav"
            _write_silence(audio)

            aligner = GentleAligner()
            aligner.cache_dir = root / "cache"
            first = aligner._cache_path(str(audio), "hello world")
            changed_text = aligner._cache_path(str(audio), "hello there")

            with audio.open("ab") as audio_file:
                audio_file.write(b"\0\0")
            changed_audio = aligner._cache_path(str(audio), "hello world")

            self.assertNotEqual(first, changed_text)
            self.assertNotEqual(first, changed_audio)


class SuppliedAlignmentValidationTest(unittest.TestCase):
    def test_accepts_complete_monotonic_contained_stt_words(self):
        transcript = "one two three four five six seven eight nine ten"
        tokens = transcript.split()
        alignments = [
            WordAlignment(token, index * 0.4, index * 0.4 + 0.25, 1.0)
            for index, token in enumerate(tokens)
        ]

        accepted = AudioProcessor._validate_supplied_alignments(
            alignments,
            transcript,
            audio_duration=5.0,
        )

        self.assertEqual(accepted, alignments)

    def test_rejects_incomplete_or_out_of_audio_stt_words(self):
        transcript = "one two three four five six seven eight nine ten"
        incomplete = [WordAlignment("one", 0.0, 0.2, 1.0)]
        tokens = transcript.split()
        outside_audio = [
            WordAlignment(token, index * 0.4, index * 0.4 + 0.25, 1.0)
            for index, token in enumerate(tokens)
        ]
        outside_audio[-1] = WordAlignment("ten", 4.8, 5.8, 1.0)

        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                incomplete,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )
        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                outside_audio,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )

    def test_rejects_timestamps_for_different_words(self):
        transcript = "one two three four five six seven eight nine ten"
        alignments = [
            WordAlignment("mismatch", index * 0.4, index * 0.4 + 0.25, 1.0)
            for index in range(10)
        ]

        self.assertEqual(
            AudioProcessor._validate_supplied_alignments(
                alignments,
                transcript,
                audio_duration=5.0,
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
