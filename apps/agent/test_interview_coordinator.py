"""Conversation coordinator behaviour with controlled speech events and server outcomes."""
import asyncio
import unittest
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from interview_capture import CaptureUnavailable, InterviewCapture
from interview_coordinator import CLOSING_LINE, InterviewCoordinator, ServerRefused

HANDOFF = .2  # scaled from the pinned 5 s; pauses below are scaled the same way (2-4 s -> .08-.16 s)


def voice(attempt='a1', status='ASKED', text='Explain retries.', has_speech=False):
    return {'nextTurnIndex': 0, 'segmentId': 'seg', 'runId': 'run', 'attemptHasSpeech': has_speech,
            'attempt': {'id': attempt, 'status': status, 'question': {'text': text}}}


class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.sent, self.requests, self.states = [], [], []
        self.next_error = None
        self.finish_error = None

        async def send(path, body):
            self.sent.append((path, dict(body)))
            if path.endswith('/asked'):
                return {**voice('a2')['attempt'], 'status': 'ASKED'}
            return {'id': body.get('id', 'chunk')}

        async def request(path, body):
            self.requests.append((path, dict(body)))
            if path.endswith('/finish') and self.finish_error:
                raise self.finish_error
            if path.endswith('/next'):
                if self.next_error:
                    raise self.next_error
                return {'id': 'a2', 'status': 'PREPARED'}
            return {'status': 'SKIPPED' if body.get('skip') else 'ANSWERED'}

        self.published = []

        async def publish_state(name, extra):
            self.states.append((name, extra.get('reason')))
            self.published.append((name, extra))

        self.capture = InterviewCapture(voice(), send, AsyncMock(), settle=.03, max_barrier=.3, unresolved_wait=.06, vad_tail=.02, grace=.005, poll=.005)
        self.capture.accepting = True; self.capture.attached = True
        self.session = Mock()
        self.session.user_state = 'listening'
        self.session.say = AsyncMock()
        self.coordinator = InterviewCoordinator(capture=self.capture, session=self.session, request=request,
            voice_state=AsyncMock(return_value=voice('a2', 'PREPARED', 'Next question?')), publish_state=publish_state,
            run_id='run', policy={'handoffSilenceMs': HANDOFF * 1000})
        await self.coordinator.question_ready(False)

    def final(self, text):
        self.capture.observe_provider_transcript(text, True); self.coordinator.on_transcript(True)

    def interim(self, text):
        self.capture.observe_provider_transcript(text, False); self.coordinator.on_transcript(False)

    def speech(self, speaking):
        (self.capture.observe_speech_start if speaking else self.capture.observe_speech_end)()
        self.coordinator.on_vad(speaking)

    def finishes(self):
        return [body for path, body in self.requests if path.endswith('/finish')]

    async def settle_tasks(self):
        if self.coordinator.ask_task:
            await self.coordinator.ask_task

    async def test_thinking_pauses_never_hand_off_and_silence_hands_off_once(self):
        self.speech(True); self.final('First idea.'); self.speech(False)
        for pause in (.08, .12, .16):  # 2 s, 3 s and 4 s pauses at this scale
            await asyncio.sleep(pause)
            self.speech(True); self.final(f'More after {pause}.'); self.speech(False)
        self.assertEqual(self.finishes(), [])
        await asyncio.sleep(HANDOFF + .2)
        await self.settle_tasks()
        self.assertEqual(len(self.finishes()), 1)
        chunks = [body['text'] for path, body in self.sent if path.endswith('/chunks')]
        self.assertEqual(chunks, ['First idea.', 'More after 0.08.', 'More after 0.12.', 'More after 0.16.'])
        self.assertEqual(self.requests[-1], ('/runs/run/next', {'afterAttemptId': 'a1'}))
        self.session.say.assert_awaited_with('Next question?', allow_interruptions=False)
        self.assertEqual(self.coordinator.state, 'listening')

    async def test_renewed_speech_or_an_interim_cancels_the_countdown(self):
        self.final('Partial answer.')
        await asyncio.sleep(HANDOFF * .6)
        self.interim('and then')
        await asyncio.sleep(HANDOFF * .8)
        self.assertEqual(self.finishes(), [])
        self.speech(True)
        await asyncio.sleep(HANDOFF * 1.2)
        self.assertEqual(self.finishes(), [])

    async def test_no_speech_means_no_automatic_handoff(self):
        await asyncio.sleep(HANDOFF * 2)
        self.assertEqual(self.finishes(), [])

    async def test_automatic_and_manual_finish_save_one_answer(self):
        self.final('Complete answer.')
        await asyncio.sleep(HANDOFF + .15)
        manual = await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        await self.settle_tasks()
        self.assertEqual(len(self.finishes()), 1)
        self.assertTrue(manual.get('duplicate') or manual.get('stale'))
        self.assertEqual(len([p for p, _ in self.sent if p.endswith('/receipts')]), 1)

    async def test_a_control_for_another_answer_never_drains_the_current_one(self):
        self.final('Answer.')
        result = await self.coordinator.complete('FINISH', str(uuid4()), 'not-current')
        self.assertTrue(result['stale'])
        self.assertEqual(self.finishes(), [])

    async def test_repeated_request_id_returns_the_recorded_outcome(self):
        self.final('Answer.')
        request_id = str(uuid4())
        first = await self.coordinator.complete('FINISH', request_id, 'a1')
        await self.settle_tasks()
        self.assertEqual(await self.coordinator.complete('FINISH', request_id, 'a1'), first)
        self.assertEqual(len(self.finishes()), 1)

    async def test_time_or_bank_limits_end_progression_without_an_error(self):
        self.next_error = ServerRefused(409, 'PRACTICE_DURATION_REACHED')
        self.final('Last answer.')
        result = await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertEqual(len(self.finishes()), 1)
        self.assertEqual(self.states[-1], ('waiting', 'PRACTICE_DURATION_REACHED'))
        self.session.say.assert_awaited_with(CLOSING_LINE, allow_interruptions=True)
        self.assertTrue(result['completed'])

    async def test_more_time_holds_the_handoff_until_resumed(self):
        self.coordinator.set_hold(True)
        self.final('Thinking out loud.')
        await asyncio.sleep(HANDOFF + .1)
        self.assertEqual(self.finishes(), [])
        self.coordinator.set_hold(False)
        await asyncio.sleep(HANDOFF + .15)
        await self.settle_tasks()
        self.assertEqual(len(self.finishes()), 1)

    async def test_unconfirmed_speech_is_never_saved_automatically(self):
        self.final('Confirmed words.')
        self.speech(True); self.speech(False)  # voiced audio without any transcript
        await asyncio.sleep(HANDOFF + .1)
        self.assertEqual(self.finishes(), [])
        self.assertIn(('listening', 'SPEECH_UNCONFIRMED'), self.states)
        # The learner can still explicitly save only the confirmed speech.
        await self.coordinator.complete('FINISH', str(uuid4()), 'a1', accept_unresolved=True)
        self.assertEqual(len(self.finishes()), 1)

    async def test_late_transcript_keeps_the_learner_listening(self):
        self.interim('still talking')
        with self.assertRaisesRegex(CaptureUnavailable, 'TRANSCRIPT_PENDING'):
            await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.session.input.set_audio_enabled.assert_called_with(True)
        self.assertEqual(self.coordinator.state, 'listening')
        self.assertEqual(self.finishes(), [])

    async def test_skip_advances_without_saving_speech(self):
        self.interim('half a thought')
        await self.coordinator.complete('SKIP', str(uuid4()), 'a1')
        await self.settle_tasks()
        self.assertEqual(self.finishes()[0]['skip'], True)
        self.assertEqual([p for p, _ in self.sent if p.endswith('/chunks')], [])

    async def test_reconnect_completes_an_unfinished_receipt_once(self):
        await self.coordinator.resume_unfinished({'id': 'receipt-1', 'action': 'FINISH'}, 'a1')
        await self.settle_tasks()
        self.assertEqual(self.finishes(), [{'receiptId': 'receipt-1', 'skip': False}])
        self.assertEqual(self.requests[-1][0], '/runs/run/next')
        again = await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertTrue(again.get('stale') or again.get('duplicate'))
        self.assertEqual(len(self.finishes()), 1)

    async def test_access_withdrawn_mid_answer_falls_back_without_advancing(self):
        self.finish_error = ServerRefused(403, 'CONVERSATION_UNAVAILABLE')
        self.final('Answer.')
        with self.assertRaises(ServerRefused):
            await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertEqual(self.states[-1], ('waiting', 'CONVERSATION_UNAVAILABLE'))
        self.assertFalse(any(p.endswith('/next') for p, _ in self.requests))

    async def test_pause_suspends_the_countdown(self):
        self.final('Answer in progress.')
        self.coordinator.suspend()
        await asyncio.sleep(HANDOFF + .1)
        self.assertEqual(self.finishes(), [])


    # ---- review findings -------------------------------------------------------------------------
    async def test_an_empty_final_never_starts_an_automatic_finish(self):
        self.capture.observe_provider_transcript('', True); self.coordinator.on_transcript(True, False)  # a cough
        await asyncio.sleep(HANDOFF * 2)
        self.assertEqual(self.finishes(), [])
        self.assertEqual([p for p, _ in self.sent if p.endswith('/receipts')], [])

    async def test_finish_before_any_answer_keeps_listening_without_a_receipt(self):
        with self.assertRaisesRegex(CaptureUnavailable, 'NO_SPEECH'):
            await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertEqual(self.states[-1], ('listening', 'NO_SPEECH'))
        self.assertEqual([p for p, _ in self.sent if p.endswith('/receipts')], [])
        self.final('Now the answer.')  # the answer is still open
        self.assertEqual(self.capture.pending[0]['body']['text'] if self.capture.pending else
                         [b['text'] for p, b in self.sent if p.endswith('/chunks')][-1], 'Now the answer.')

    async def test_a_failed_finish_stops_in_waiting_and_continue_finishes_it_without_draining_again(self):
        self.finish_error = ConnectionError()
        self.final('Answer.')
        with self.assertRaises(ConnectionError):
            await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertEqual(self.states[-1], ('waiting', 'FINISH_FAILED'))
        self.finish_error = None
        await self.coordinator.next_after('a1')
        await self.settle_tasks()
        self.assertEqual(len([p for p, _ in self.sent if p.endswith('/receipts')]), 1)
        self.assertEqual(len(self.finishes()), 2)
        self.assertEqual(self.requests[-1], ('/runs/run/next', {'afterAttemptId': 'a1'}))
        self.assertEqual(self.coordinator.state, 'listening')

    async def test_a_failed_advance_stops_in_waiting_and_continue_advances_once(self):
        self.next_error = ConnectionError()
        self.final('Answer.')
        result = await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        self.assertTrue(result['completed'])
        self.assertEqual(self.states[-1], ('waiting', 'NEXT_FAILED'))
        self.next_error = None
        await self.coordinator.next_after('a1')
        await self.settle_tasks()
        self.assertEqual(len(self.finishes()), 1)
        self.assertEqual(self.coordinator.state, 'listening')

    async def test_pause_during_an_automatic_save_never_creates_the_next_question(self):
        self.final('Last answer before pausing.')
        task = asyncio.create_task(self.coordinator.complete('FINISH', str(uuid4()), 'a1'))
        await asyncio.sleep(0)
        self.coordinator.suspend()
        result = await task
        self.assertTrue(result['completed'])
        self.assertFalse(any(p.endswith('/next') for p, _ in self.requests))

    async def test_resuming_after_a_finished_answer_moves_to_the_next_question(self):
        self.capture.state = voice('a1', 'ANSWERED'); self.capture.accepting = False; self.states.clear()
        await self.coordinator.begin(voice('a1', 'ANSWERED'))
        await self.settle_tasks()
        self.assertEqual(self.requests, [('/runs/run/next', {'afterAttemptId': 'a1'})])
        self.assertEqual([s for s, _ in self.states], ['preparing', 'asking', 'listening'])  # never 'listening' with no question
        self.assertEqual(self.coordinator.state, 'listening')

    async def test_the_first_question_is_announced_as_asking_before_it_is_read(self):
        self.capture.accepting = False; self.states.clear()
        await self.coordinator.begin(voice('a1', 'PREPARED'))
        self.assertEqual([s for s, _ in self.states][:2], ['asking', 'listening'])

    async def test_resume_auto_outside_listening_never_arms_a_handoff(self):
        self.final('Answer.')
        self.coordinator.state = 'saving'
        self.coordinator.set_hold(True); self.coordinator.set_hold(False)
        await asyncio.sleep(HANDOFF * 2)
        self.assertEqual(self.finishes(), [])

    async def test_hold_is_published_so_the_browser_matches_the_agent(self):
        self.coordinator.set_hold(True)
        await asyncio.sleep(0.01)
        self.assertTrue(self.published[-1][1]['hold'])

    async def test_withdrawn_access_hands_the_saved_receipt_to_the_browser(self):
        self.finish_error = ServerRefused(403, 'CONVERSATION_UNAVAILABLE')
        self.final('Answer.')
        with self.assertRaises(ServerRefused):
            await self.coordinator.complete('FINISH', str(uuid4()), 'a1')
        name, extra = self.published[-1]
        self.assertEqual((name, extra['reason'], extra['receiptAction']), ('waiting', 'CONVERSATION_UNAVAILABLE', 'FINISH'))
        self.assertTrue(extra['receiptId'])
        self.assertFalse(self.coordinator.active)

if __name__ == '__main__':
    unittest.main()
