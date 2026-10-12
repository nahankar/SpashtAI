"""Idle STT keepalive, real-frame ordering and cancellation boundaries."""
import asyncio
import unittest
from livekit import rtc
from interview_audio import keep_interview_audio_alive

class InterviewAudioTests(unittest.IsolatedAsyncioTestCase):
    async def test_idle_frames_keep_stream_alive_then_real_audio_is_unchanged(self):
        queue=asyncio.Queue()
        async def source():
            while True:
                frame=await queue.get()
                if frame is None:return
                yield frame
        stream=keep_interview_audio_alive(source(),interval=.01)
        for _ in range(3):
            silence=await anext(stream)
            self.assertEqual(silence.sample_rate,16000)
            self.assertEqual(silence.num_channels,1)
            self.assertEqual(silence.data.tobytes(),bytes(320))
        first=rtc.AudioFrame(bytes([1,0])*160,16000,1,160)
        second=rtc.AudioFrame(bytes([2,0])*160,16000,1,160)
        await queue.put(first);await queue.put(second);await queue.put(None)
        self.assertIs(await anext(stream),first)
        self.assertIs(await anext(stream),second)
        with self.assertRaises(StopAsyncIteration):await anext(stream)

    async def test_closing_keepalive_cancels_its_pending_read(self):
        closed=asyncio.Event()
        async def source():
            try:
                await asyncio.Future()
                yield rtc.AudioFrame(bytes(320),16000,1,160)
            finally:closed.set()
        stream=keep_interview_audio_alive(source(),interval=.01)
        await anext(stream)
        await stream.aclose()
        self.assertTrue(closed.is_set())

    async def test_mismatched_input_format_fails_explicitly(self):
        async def source():yield rtc.AudioFrame(bytes(960),48000,1,480)
        with self.assertRaisesRegex(ValueError,'16 kHz mono'):
            await anext(keep_interview_audio_alive(source(),interval=.01))

if __name__=='__main__':unittest.main()
