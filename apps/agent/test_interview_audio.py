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


from interview_audio import RecognizerWatch, supervise_recognizer


def voiced(n):
    return rtc.AudioFrame(bytes([n, 0]) * 160, 16000, 1, 160)


class RecognizerStallTests(unittest.IsolatedAsyncioTestCase):
    """A recognizer stream that stops returning results while the learner speaks is replaced."""

    async def asyncSetUp(self):
        self.source = asyncio.Queue()
        self.opened, self.streams = [], []

        async def audio():
            while (frame := await self.source.get()) is not None:
                yield frame
        self.audio = audio()

    def recognizer(self, *, dead):
        received = []
        self.streams.append(received)

        async def stream(frames):
            try:
                async for frame in frames:
                    received.append(frame)
                    if not dead and frame.data.tobytes()[0] == 9:
                        yield 'final'
            finally:
                received.append('closed')
        return stream

    async def test_speech_without_results_restarts_and_replays_what_was_said(self):
        watch = RecognizerWatch(stall=.08)
        streams = iter([self.recognizer(dead=True), self.recognizer(dead=False)])
        events = supervise_recognizer(self.audio, lambda frames: next(streams)(frames), watch, self.opened.append, poll=.01)
        reading = asyncio.ensure_future(anext(events))
        await self.source.put(voiced(1)); await asyncio.sleep(.4)  # outside the replay margin
        watch.speech_started()
        spoken_at = watch.unanswered_since
        for n in (2, 3):
            await self.source.put(voiced(n)); await asyncio.sleep(.01)
        await asyncio.sleep(.12)  # the stall restarts the stream
        await self.source.put(voiced(9))
        self.assertEqual(await asyncio.wait_for(reading, 2), 'final')
        dead, replacement = self.streams
        self.assertEqual(dead[-1], 'closed')  # the stalled stream was closed and got no later audio
        bytes_of = lambda frames: [f.data.tobytes()[0] for f in frames if f != 'closed']
        self.assertEqual(bytes_of(dead), [1, 2, 3])
        # Audio from the unanswered speech onwards (not before it) reaches the replacement, in order.
        self.assertEqual(bytes_of(replacement), [2, 3, 9])
        self.assertEqual(len(self.opened), 2)
        self.assertGreaterEqual(self.opened[1], spoken_at - .3)
        self.assertIsNone(watch.unanswered_since)
        await self.source.put(None)
        with self.assertRaises(StopAsyncIteration):
            await asyncio.wait_for(anext(events), 2)

    async def test_silence_or_a_working_stream_never_restarts(self):
        watch = RecognizerWatch(stall=.05)
        events = supervise_recognizer(self.audio, self.recognizer(dead=False), watch, self.opened.append, poll=.01)
        reading = asyncio.ensure_future(anext(events))
        for n in (1, 2):
            await self.source.put(voiced(n))
        await asyncio.sleep(.15)  # a dead-quiet stream without speech is never treated as stalled
        watch.speech_started(); await self.source.put(voiced(9))
        self.assertEqual(await asyncio.wait_for(reading, 2), 'final')
        watch.result()
        await asyncio.sleep(.1)
        self.assertEqual(len(self.streams), 1)
        self.assertEqual(len(self.opened), 1)
        await self.source.put(None)
        with self.assertRaises(StopAsyncIteration):
            await asyncio.wait_for(anext(events), 2)
