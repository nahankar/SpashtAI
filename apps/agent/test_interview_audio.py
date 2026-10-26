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



import time
from interview_audio import RecognizerWatch, supervise_recognizer


def voiced(n):
    return rtc.AudioFrame(bytes([n, 0]) * 160, 16000, 1, 160)


def marker(frame):
    return frame.data.tobytes()[0]


class Recognizer:
    """A scripted streaming recognizer: maps frame markers to interim/final results; can stall, fail or end."""

    def __init__(self, script=None, *, stall_after=None, fail_after=None, end_after=None):
        self.script, self.stall_after, self.fail_after, self.end_after = script or {}, stall_after, fail_after, end_after
        self.received, self.closed = [], False

    async def __call__(self, frames):
        try:
            async for frame in frames:
                self.received.append(marker(frame))
                count = len(self.received)
                if self.fail_after is not None and count >= self.fail_after:
                    raise RuntimeError('stream broke')
                if self.end_after is not None and count >= self.end_after:
                    return
                if self.stall_after is not None and count > self.stall_after:
                    continue  # silently stopped: audio is accepted, nothing comes back
                if marker(frame) in self.script:
                    yield (self.script[marker(frame)], marker(frame), time.time())
        finally:
            self.closed = True


class RecognizerStallTests(unittest.IsolatedAsyncioTestCase):
    """Recognizer streams that stop responding are replaced; silence, healthy speech and teardown never are."""

    async def asyncSetUp(self):
        self.source = asyncio.Queue()
        self.opened, self.issues, self.results = [], [], []

        async def audio():
            while (frame := await self.source.get()) is not None:
                yield frame
        self.audio = audio()

    def supervise(self, watch, recognizers, **options):
        streams = iter(recognizers)
        events = supervise_recognizer(self.audio, lambda frames: next(streams)(frames), watch, self.opened.append, poll=.01,
                                      on_issue=lambda kind, detail: self.issues.append((kind, detail)), **options)

        async def consume():
            # As interview_voice does: every interim/final is progress, and a final commits the audio it covers.
            async for kind, mark, at in events:
                watch.result(kind == 'final', at if kind == 'final' else None)
                self.results.append((kind, mark))
        return events, asyncio.create_task(consume())

    async def send(self, *marks, gap=.02):
        for mark in marks:
            await self.source.put(voiced(mark)); await asyncio.sleep(gap)

    async def finish(self, task):
        await self.source.put(None)
        await asyncio.wait_for(task, 2)

    async def test_a_stream_that_stops_mid_utterance_after_results_is_replaced_without_duplicating_words(self):
        watch = RecognizerWatch(stall=.25, min_voiced=.1)
        first = Recognizer({2: 'interim', 3: 'final'}, stall_after=3)
        replacement = Recognizer({4: 'interim', 6: 'final'})
        _, task = self.supervise(watch, [first, replacement])
        watch.speech_started()
        await self.send(1, 2, 3)
        await asyncio.sleep(.15)  # committed words end before the margin; speech continues without a pause
        await self.send(4, 5, 6)
        watch.speech_ended()  # the utterance continued past the final with no further results
        await asyncio.sleep(.3)
        self.assertTrue(first.closed)
        self.assertEqual(first.received, [1, 2, 3, 4, 5, 6])
        # Only audio after the committed final is resent, in order, then live audio follows.
        self.assertEqual(replacement.received[:3], [4, 5, 6])
        self.assertEqual([r for r in self.results if r[0] == 'final'], [('final', 3), ('final', 6)])
        self.assertEqual(self.issues[0][0], 'restarted')
        self.assertEqual(self.issues[0][1]['lostSeconds'], 0)
        self.assertEqual(len(self.opened), 2)
        await self.finish(task)

    async def test_a_partial_with_no_final_is_owed_a_result_even_after_speech_ends(self):
        watch = RecognizerWatch(stall=.08)
        first = Recognizer({1: 'interim'}, stall_after=1)
        replacement = Recognizer({1: 'final'})
        _, task = self.supervise(watch, [first, replacement])
        watch.speech_started(); await self.send(1); watch.speech_ended()
        await asyncio.sleep(.25)
        self.assertEqual(replacement.received[:1], [1])
        self.assertIn(('final', 1), self.results)
        await self.finish(task)

    async def test_a_replacement_that_stalls_again_backs_off_reports_and_recovers(self):
        watch = RecognizerWatch(stall=.05)
        streams = [Recognizer(stall_after=0), Recognizer(stall_after=0), Recognizer({7: 'final'})]
        _, task = self.supervise(watch, streams)
        watch.speech_started()
        await self.send(1, 2)
        for _ in range(100):  # 0.05 s, then 0.1 s, then 0.2 s windows
            if len(self.opened) == 3:
                break
            await asyncio.sleep(.02)
        self.assertEqual(len(self.opened), 3)
        kinds = [kind for kind, _ in self.issues]
        self.assertEqual(kinds, ['restarted', 'restarted', 'unavailable'])
        watch.speech_ended()
        await self.send(7); await asyncio.sleep(.1)
        self.assertEqual(self.issues[-1][0], 'recovered')
        self.assertEqual(watch.restarts, 0)
        await self.finish(task)

    async def test_healthy_speech_silence_short_sounds_and_mute_never_restart(self):
        watch = RecognizerWatch(stall=.06)
        healthy = Recognizer({n: 'interim' for n in range(1, 9)} | {9: 'final'}, stall_after=None)
        _, task = self.supervise(watch, [healthy])
        watch.speech_started()
        await self.send(*range(1, 10), gap=.03)  # results keep coming while the learner talks for longer than the window
        watch.speech_ended()
        await asyncio.sleep(.15)  # silence after a final
        watch.speech_started(); await asyncio.sleep(.02); watch.speech_ended()  # a cough: shorter than MIN_VOICED
        await asyncio.sleep(.15)
        watch.speech_ended()  # mute stops voice activity; no frames arrive
        await asyncio.sleep(.15)
        self.assertEqual(len(self.opened), 1)
        self.assertEqual(self.issues, [])
        await self.finish(task)

    async def test_explicit_errors_and_early_endings_are_replaced_with_the_unrecognised_audio(self):
        watch = RecognizerWatch(stall=5)
        broken, ended, healthy = Recognizer(fail_after=2), Recognizer(end_after=1), Recognizer({3: 'final'})
        _, task = self.supervise(watch, [broken, ended, healthy])
        watch.speech_started()
        await self.send(1, 2, 3, gap=.03)
        await asyncio.sleep(1.5)  # the second failure in a row waits for its backoff before reopening
        reasons = [detail['reason'] for kind, detail in self.issues if kind == 'restarted']
        self.assertEqual(reasons, ['stream_error:RuntimeError', 'stream_ended'])
        self.assertEqual(healthy.received[0], 1)  # nothing was committed, so everything since speech began is resent
        self.assertIn(('final', 3), self.results)
        await self.finish(task)

    async def test_recovery_beyond_the_replay_bound_reports_the_untranscribed_seconds(self):
        watch = RecognizerWatch(stall=.3)
        dead, replacement = Recognizer(stall_after=0), Recognizer()
        _, task = self.supervise(watch, [dead, replacement], replay=.15)
        watch.speech_started()
        await self.send(*range(1, 16), gap=.025)
        await asyncio.sleep(.1)
        restarted = [detail for kind, detail in self.issues if kind == 'restarted']
        self.assertEqual(len(restarted), 1)
        self.assertGreater(restarted[0]['lostSeconds'], 0)  # audio older than the bound is not resent
        self.assertNotIn(1, replacement.received)
        self.assertLessEqual(restarted[0]['replayedSeconds'], .2)
        await self.finish(task)

    async def test_teardown_or_a_question_change_discards_the_buffer(self):
        watch = RecognizerWatch(stall=.05)
        first = Recognizer(stall_after=0)
        events, task = self.supervise(watch, [first])
        watch.speech_started(); await self.send(1, 2)
        task.cancel(); await asyncio.gather(task, return_exceptions=True)
        await events.aclose()  # the next answer opens a new stream (session.clear_user_turn) with an empty buffer
        self.assertTrue(first.closed)
        self.assertEqual(len(self.opened), 1)
        watch.reset()
        self.assertFalse(watch.stalled())


class RecognizerWatchTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.watch = RecognizerWatch(stall=6, clock=lambda: self.now)

    def test_codex_sequence_speech_then_a_result_then_continuous_speech_is_detected(self):
        # speech_started() -> result() -> continued speech with no new speaking transition and no results.
        self.watch.speech_started(100.0)
        self.now = 101.0; self.watch.result(final=False)
        self.now = 106.9; self.assertFalse(self.watch.stalled())
        self.now = 107.0; self.assertTrue(self.watch.stalled())

    def test_continuous_speech_with_regular_results_never_stalls(self):
        self.watch.speech_started(100.0)
        for step in range(1, 60):
            self.now = 100.0 + step; self.watch.result(final=step % 5 == 0, covered_until=self.now - .2)
            self.assertFalse(self.watch.stalled())

    def test_silence_and_short_sounds_are_owed_nothing(self):
        self.now = 200.0; self.assertFalse(self.watch.stalled())
        self.watch.speech_started(200.0); self.now = 200.4; self.watch.speech_ended(200.4)
        self.now = 260.0; self.assertFalse(self.watch.stalled())

    def test_short_bursts_add_up_and_a_partial_without_final_is_owed(self):
        for start in (100.0, 102.0):
            self.watch.speech_started(start); self.watch.speech_ended(start + .9)
        self.now = 105.9; self.assertFalse(self.watch.stalled())
        self.now = 106.0; self.assertTrue(self.watch.stalled())  # 1.8 s of speech since 100.0 had no result
        self.watch.reset()
        self.now = 300.0; self.watch.result(final=False)
        self.now = 306.0; self.assertTrue(self.watch.stalled())

    def test_replay_starts_after_committed_words_and_backoff_grows(self):
        self.watch.speech_started(100.0)
        self.now = 102.0; self.watch.result(final=True, covered_until=101.8)
        self.assertAlmostEqual(self.watch.replay_from(), 101.9)
        self.now = 108.0; self.assertTrue(self.watch.stalled())
        self.watch.restarted(); self.assertFalse(self.watch.stalled())
        self.now = 119.9; self.assertFalse(self.watch.stalled())  # the replacement gets 12 s
        self.now = 120.0; self.assertTrue(self.watch.stalled())
        self.watch.restarted(); self.assertTrue(self.watch.failing)

    def test_a_new_stream_keeps_the_session_voice_state_but_forgets_recognizer_progress(self):
        self.watch.speech_started(100.0)
        self.now = 101.0; self.watch.result(final=True, covered_until=100.9)
        self.now = 102.0; self.watch.new_stream()
        self.assertTrue(self.watch.speaking); self.assertIsNone(self.watch.committed_until); self.assertEqual(self.watch.restarts, 0)
        self.now = 108.0; self.assertTrue(self.watch.stalled())


class RecognizerTeardownTests(unittest.IsolatedAsyncioTestCase):
    """Closing the supervisor leaves no running task and no unretrieved exception on the event loop."""

    async def asyncSetUp(self):
        import gc
        self.gc = gc
        self.loop_errors = []
        loop = asyncio.get_running_loop()
        self.previous_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: self.loop_errors.append(context.get('message', '')))
        self.baseline = set(asyncio.all_tasks())

    async def asyncTearDown(self):
        asyncio.get_running_loop().set_exception_handler(self.previous_handler)

    async def assert_clean(self):
        for _ in range(5):
            await asyncio.sleep(0)
        self.gc.collect()  # unretrieved task exceptions are reported when the task is collected
        await asyncio.sleep(0)
        self.assertEqual(self.loop_errors, [])
        leftover = [t for t in asyncio.all_tasks() - self.baseline if t is not asyncio.current_task() and not t.done()]
        self.assertEqual(leftover, [])

    async def run_and_close(self, recognizer, *, during):
        source = asyncio.Queue()

        async def audio():
            while (frame := await source.get()) is not None:
                yield frame
        watch = RecognizerWatch(stall=.05)
        events = supervise_recognizer(audio(), recognizer, watch, lambda at: None, poll=.01)
        reading = asyncio.ensure_future(anext(events))
        watch.speech_started()
        for n in range(1, 4):
            await source.put(voiced(n)); await asyncio.sleep(.01)
        await during()
        # A question change or disconnect: the consumer is cancelled, then the node's iterator is closed.
        reading.cancel()
        await asyncio.gather(reading, return_exceptions=True)
        await events.aclose()
        return recognizer

    async def test_closing_while_a_read_is_pending_settles_every_task(self):
        recognizer = Recognizer()  # healthy but silent: the read is pending when the consumer goes away
        await self.run_and_close(recognizer, during=lambda: asyncio.sleep(.02))
        self.assertTrue(recognizer.closed)
        await self.assert_clean()

    async def test_closing_during_a_stall_restart_settles_every_task(self):
        streams = iter([Recognizer(stall_after=0), Recognizer(stall_after=0), Recognizer(stall_after=0)])
        opened = []

        def recognizer(frames):
            stream = next(streams); opened.append(stream); return stream(frames)
        await self.run_and_close(recognizer, during=lambda: asyncio.sleep(.12))  # at least one replacement opened
        self.assertGreaterEqual(len(opened), 2)
        self.assertTrue(all(stream.closed for stream in opened))
        await self.assert_clean()

    async def test_closing_after_the_audio_ends_settles_every_task(self):
        source_done = asyncio.Event()

        async def during():
            source_done.set()
        await self.run_and_close(Recognizer({3: 'final'}), during=during)
        await self.assert_clean()


from types import SimpleNamespace
from interview_audio import dev_stt_fault, inject_stt_fault


class DevSttFaultTests(unittest.IsolatedAsyncioTestCase):
    def test_honoured_only_for_a_local_development_agent(self):
        local = {"SPASHTAI_DEV_STT_FAULT": "stall-once", "LIVEKIT_URL": "ws://localhost:7880"}
        self.assertEqual(dev_stt_fault(local), "stall-once")
        self.assertIsNone(dev_stt_fault({**local, "ENVIRONMENT": "production"}))
        self.assertIsNone(dev_stt_fault({**local, "LIVEKIT_URL": "wss://spashtai.livekit.cloud"}))
        self.assertIsNone(dev_stt_fault({**local, "SPASHTAI_DEV_STT_FAULT": "something-else"}))
        self.assertIsNone(dev_stt_fault({"LIVEKIT_URL": "ws://localhost:7880"}))

    async def collect(self, mode, streams):
        def real(frames):
            async def run():
                for kind in frames:
                    yield SimpleNamespace(type=SimpleNamespace(value=kind))
            return run()
        open_stream = inject_stt_fault(real, mode)
        out = []
        for script in streams:
            out.append([e.type.value async for e in open_stream(script)])
        return out

    async def test_modes_withhold_results_like_the_observed_failure(self):
        script = ["interim_transcript", "final_transcript", "interim_transcript", "final_transcript"]
        once = await self.collect("stall-once", [script, script])
        self.assertEqual(once, [script[:2], script])
        repeated = await self.collect("stall-repeatedly", [script] * 4)
        self.assertEqual(repeated, [script[:2], [], [], script])
