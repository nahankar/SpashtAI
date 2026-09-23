import unittest

from analytics.signal_api import SignalHandler


def payload():
    return {
        "audioPath": "/tmp/user.wav",
        "audioInputSignature": "server-signature",
        "expectedAudioInputSignature": "server-signature",
        "analyzerVersion": "delivery-raw-v1",
        "completeSegmentAudio": True,
        "segments": [{
            "segmentId": "segment-1",
            "replayOffsetSec": 0,
            "durationSec": 5,
            "audioAvailable": True,
        }],
        "turns": [{
            "turnId": "turn-1",
            "segmentId": "segment-1",
            "audioStart": 0.2,
            "audioEnd": 2,
            "alignmentCoverage": 1,
            "words": [
                {"w": "Hello", "start": 0.2, "end": 0.6, "timingOrigin": "actual"},
                {"w": "there", "start": 0.7, "end": 1.1, "timingOrigin": "actual"},
            ],
        }],
    }


class SignalApiDeliveryRequestTest(unittest.TestCase):
    def test_accepts_server_validated_segment_clock_and_word_timing(self):
        request = SignalHandler._delivery_feature_request(payload())
        self.assertTrue(request.complete_segment_audio)
        self.assertEqual(request.segments[0].segment_id, "segment-1")
        self.assertEqual(request.turns[0].clock, "segment")
        self.assertEqual(request.turns[0].words[0].timing_origin, "actual")

    def test_rejects_missing_server_signature_and_synthetic_timing(self):
        missing_signature = payload()
        missing_signature["audioInputSignature"] = ""
        with self.assertRaisesRegex(ValueError, "audioInputSignature"):
            SignalHandler._delivery_feature_request(missing_signature)

        synthetic = payload()
        synthetic["turns"][0]["words"][0]["timingOrigin"] = "synthetic"
        request = SignalHandler._delivery_feature_request(synthetic)
        # Parsing preserves provenance; extraction, not transport, suppresses
        # synthetic timestamps so the server receives an explicit reason.
        self.assertEqual(request.turns[0].words[0].timing_origin, "synthetic")

    def test_parses_actual_per_segment_capture_settings(self):
        body = payload()
        body["segments"][0]["capture"] = {
            "automaticGainControl": False,
            "noiseSuppression": True,
            "echoCancellation": None,
            "voiceIsolation": False,
        }
        request = SignalHandler._delivery_feature_request(body)
        self.assertFalse(request.segments[0].capture_metadata.automatic_gain_control)
        self.assertTrue(request.segments[0].capture_metadata.noise_suppression)

        body["segments"][0]["capture"]["noiseSuppression"] = "false"
        with self.assertRaisesRegex(ValueError, "capture settings"):
            SignalHandler._delivery_feature_request(body)
