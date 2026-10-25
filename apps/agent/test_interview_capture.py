"""Provider-final speech and save barrier regression tests."""
import asyncio
import json
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4
from interview_capture import InterviewCapture, CaptureUnavailable, parse_control
from interview_audio import ProviderClock
from livekit.agents.types import TimedString
from voice_backends import VoiceBackendConfig, build_interview_session, _build_pipeline_bedrock

SETTLE, MAX_BARRIER, UNRESOLVED_WAIT, VAD_TAIL = .05, .4, .1, .03


def state(index=0, attempt='attempt-1'):
    return {'nextTurnIndex':index,'segmentId':'segment-1','attempt':{'id':attempt,'status':'ASKED','question':{'text':'Explain queue retries.'}}}

class CaptureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent=[]
        async def send(path, body):
            self.sent.append((path,body.copy()))
            return {'id':body.get('id','chunk')}
        self.send=send
        self.capture=InterviewCapture(state(),send,AsyncMock(),settle=SETTLE,max_barrier=MAX_BARRIER,unresolved_wait=UNRESOLVED_WAIT,vad_tail=VAD_TAIL,grace=.01,poll=.005)
        self.capture.accepting=True; self.capture.attached=True
        self.session=Mock()
        self.session.user_state='listening'
        self.session.commit_user_turn=AsyncMock(return_value='SDK promoted interim must never be saved')

    def later(self, delay, action):
        async def run():
            await asyncio.sleep(delay); action()
        return asyncio.create_task(run())

    async def test_delayed_final_is_persisted_before_receipt(self):
        self.capture.observe_provider_transcript('partial',False)
        self.later(.03,lambda:self.capture.observe_provider_transcript('Actual final.',True))
        ack=await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(ack['action'],'FINISH')
        self.assertEqual(self.sent[0][1]['text'],'Actual final.')
        self.assertEqual(self.sent[1][1]['lastTurnIndex'],0)
        self.assertFalse(self.capture.accepting)
        self.session.input.set_audio_enabled.assert_called_with(False)
        # The SDK commit (and its fixed 8 s transcript wait) is no longer part of saving.
        self.session.commit_user_turn.assert_not_called()

    async def test_an_interim_that_never_finalises_cannot_be_saved(self):
        self.capture.observe_provider_transcript('not final',False)
        loop=asyncio.get_running_loop(); start=loop.time()
        with self.assertRaisesRegex(CaptureUnavailable,'TRANSCRIPT_PENDING'):
            await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertGreaterEqual(loop.time()-start,MAX_BARRIER-.01)
        self.assertEqual(self.sent,[])
        self.assertTrue(self.capture.accepting)

    async def test_voiced_speech_with_an_interim_waits_for_its_final(self):
        self.capture.observe_speech_start()
        self.capture.observe_provider_transcript('still speaking',False)
        with self.assertRaisesRegex(CaptureUnavailable,'TRANSCRIPT_PENDING'):
            await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(self.sent,[])

    async def test_voice_beyond_the_vad_tail_after_a_final_waits_for_a_new_final(self):
        self.capture.observe_provider_transcript('First sentence.',True)
        await self.capture.worker
        await asyncio.sleep(VAD_TAIL*2)
        self.capture.observe_speech_start()  # still voiced well after that final: more words exist
        self.later(.1,lambda:self.capture.observe_provider_transcript('Second sentence.',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([body['text'] for path,body in self.sent if path.endswith('/chunks')],['First sentence.','Second sentence.'])
        self.assertEqual(self.sent[-1][1]['lastTurnIndex'],1)

    async def test_finish_right_after_the_last_word_does_not_wait_for_a_final_that_will_never_come(self):
        self.capture.observe_speech_start()
        self.capture.observe_provider_transcript('Last words.',True)  # VAD still in its trailing silence
        loop=asyncio.get_running_loop(); start=loop.time()
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertLess(loop.time()-start,MAX_BARRIER/2)
        self.assertEqual(self.sent[0][1]['text'],'Last words.')

    async def test_new_speech_events_restart_the_settle_window(self):
        loop=asyncio.get_running_loop(); start=loop.time()
        self.later(.04,lambda:self.capture.observe_provider_transcript('Late words.',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertGreaterEqual(loop.time()-start,.04+SETTLE-.01)
        self.assertEqual(self.sent[0][1]['text'],'Late words.')

    async def test_unresolved_voiced_speech_is_never_discarded_automatically(self):
        self.capture.observe_provider_transcript('Complete answer.',True)
        await self.capture.worker
        self.capture.observe_speech_start()  # voiced audio that has produced no transcript (a cough or words)
        self.capture.observe_speech_end()
        with self.assertRaisesRegex(CaptureUnavailable,'TRANSCRIPT_PENDING'):
            await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertTrue(self.capture.accepting)
        self.assertEqual([path for path,_ in self.sent if path.endswith('/receipts')],[])
        # Recoverable: the learner may explicitly save only the confirmed speech.
        ack=await self.capture.drain(self.session,'FINISH',str(uuid4()),accept_unresolved=True)
        self.assertEqual(ack['action'],'FINISH')
        self.assertEqual(self.sent[-1][1]['lastTurnIndex'],0)

    async def test_unresolved_speech_that_turns_out_to_be_words_is_still_saved(self):
        self.capture.observe_speech_start(); self.capture.observe_speech_end()
        self.later(.2,lambda:self.capture.observe_provider_transcript('Words after a slow recognizer.',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(self.sent[0][1]['text'],'Words after a slow recognizer.')

    async def test_an_empty_provider_final_resolves_a_pending_interim(self):
        self.capture.observe_provider_transcript('Saved part.',True)
        self.capture.observe_provider_transcript('uh',False)
        self.later(.03,lambda:self.capture.observe_provider_transcript('',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([body.get('text') for path,body in self.sent if path.endswith('/chunks')],['Saved part.'])

    async def test_finish_during_untranscribed_speech_waits_for_its_final(self):
        self.capture.observe_provider_transcript('Earlier sentence.',True)
        await self.capture.worker
        self.capture.observe_speech_start()  # new speech, no interim yet when Finish arrives
        self.later(.15,lambda:self.capture.observe_provider_transcript('and the last words.',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([body.get('text') for path,body in self.sent if path.endswith('/chunks')],['Earlier sentence.','and the last words.'])
        self.assertEqual(self.sent[-1][1]['lastTurnIndex'],1)

    async def test_short_and_long_answers_keep_every_final_in_order(self):
        texts=['Yes.']+[f'Point {n} of a longer answer.' for n in range(1,6)]
        for n,text in enumerate(texts):
            self.later(.01*n,lambda text=text:self.capture.observe_provider_transcript(text,True))
        await asyncio.sleep(.08)
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([body.get('text') for path,body in self.sent if path.endswith('/chunks')],texts)
        self.assertEqual(self.sent[-1][1]['lastTurnIndex'],len(texts)-1)

    async def test_skip_is_immediate_and_fences_its_late_speech_from_the_next_answer(self):
        self.capture.observe_provider_transcript('unfinished thought',False)
        loop=asyncio.get_running_loop(); start=loop.time()
        ack=await self.capture.drain(self.session,'SKIP',str(uuid4()))
        self.assertEqual(ack['action'],'SKIP')
        self.assertLess(loop.time()-start,SETTLE)
        self.assertEqual(self.sent[-1][1]['lastTurnIndex'],-1)
        # A late final for the skipped audio is not part of any answer.
        self.capture.observe_provider_transcript('late skipped words',True)
        self.assertEqual(len(self.capture.pending),0)
        # The next question resets the recognizer stream before it accepts speech.
        accepting_at_reset=[]
        self.session.clear_user_turn.side_effect=lambda:accepting_at_reset.append(self.capture.accepting)
        self.session.say=AsyncMock()
        async def asked(path,body): return state(attempt='attempt-2')['attempt']
        self.capture.send=asked
        await self.capture.activate_question(self.session,state(attempt='attempt-2'))
        self.assertEqual(accepting_at_reset,[False])
        self.assertTrue(self.capture.accepting)
        self.capture.observe_provider_transcript('first words of answer two',True)
        self.assertEqual(self.capture.pending[0]['attemptId'],'attempt-2')

    async def test_speech_after_the_barrier_is_not_attached_to_the_answer(self):
        self.capture.observe_provider_transcript('The answer.',True)
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.capture.observe_provider_transcript('Talking after saving.',True)
        self.assertEqual(len(self.capture.pending),0)
        self.assertEqual([body.get('text') for path,body in self.sent if path.endswith('/chunks')],['The answer.'])

    async def test_complete_speech_saves_after_the_settle_window_not_a_fixed_wait(self):
        self.capture.observe_provider_transcript('Done.',True)
        loop=asyncio.get_running_loop(); start=loop.time()
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertLess(loop.time()-start,SETTLE*4)

    async def test_failed_storage_keeps_chunk_then_idempotent_retry_seals_segment(self):
        fail=True
        async def send(path,body):
            if fail: raise ConnectionError()
            return await self.send(path,body)
        self.capture.send=send
        self.capture.observe_provider_transcript(' Unchanged final. ',True)
        request=str(uuid4())
        with self.assertRaisesRegex(CaptureUnavailable,'SAVE_FAILED'):
            await self.capture.drain(self.session,'PAUSE',request)
        self.assertEqual(len(self.capture.pending),1)
        fail=False
        ack=await self.capture.drain(self.session,'PAUSE',request)
        self.assertEqual(self.sent[0][1]['text'],' Unchanged final. ')
        self.assertEqual(self.sent[0][1]['sourceTurnId'],'user_turn_0')
        self.assertTrue(self.capture.sealed)
        self.assertEqual(await self.capture.drain(self.session,'PAUSE',request),ack)
        with self.assertRaisesRegex(CaptureUnavailable,'REQUEST_CONFLICT'):
            await self.capture.drain(self.session,'LEAVE',request)
        self.assertEqual(len(self.sent),2)

    async def test_silent_finish_keeps_the_answer_open_and_never_saves_sdk_fallback_text(self):
        # No receipt for an empty answer: a FINISH receipt would fence later speech for this question.
        with self.assertRaisesRegex(CaptureUnavailable,'NO_SPEECH'):
            await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(self.sent,[])
        self.assertTrue(self.capture.accepting)
        self.session.input.set_audio_enabled.assert_called_with(True)
        # Pause still records the (empty) boundary without any SDK text.
        await self.capture.drain(self.session,'PAUSE',str(uuid4()))
        self.assertEqual(self.sent[0][1]['lastTurnIndex'],-1)
        self.assertNotIn('text',self.sent[0][1])

    async def test_exact_question_is_spoken_before_input_opens(self):
        self.capture.accepting=False
        order=[]
        self.session.input.set_audio_enabled.side_effect=lambda value:order.append(('input',value))
        self.session.say=AsyncMock(side_effect=lambda text,**kwargs:order.append(('say',text)))
        async def send(path,body):
            order.append(('asked',body['questionText']))
            return state()['attempt']
        self.capture.send=send
        await self.capture.activate_question(self.session,state())
        self.assertEqual(order,[('input',False),('say','Explain queue retries.'),('asked','Explain queue retries.'),('input',True)])
        self.session.clear_user_turn.assert_called_once()
        self.session.say.assert_awaited_once_with('Explain queue retries.',allow_interruptions=False)

    async def test_server_index_is_used_after_resume(self):
        resumed=InterviewCapture(state(index=7),self.send,AsyncMock()); resumed.accepting=True
        resumed.observe_provider_transcript('After refresh',True)
        await resumed.worker
        self.assertEqual(self.sent[-1][1]['sourceTurnId'],'user_turn_7')
        self.assertEqual(self.sent[-1][1]['localTurnIndex'],7)

    # ---- audio-time ordering (review findings) -------------------------------------------------
    async def test_a_late_final_for_earlier_speech_does_not_resolve_newer_speech(self):
        now=time.time()
        self.capture.observe_speech_start(at=now-1.0)  # 'Done.' starts after the earlier sentence ended
        # Earlier sentence: its words end 1.6 s before 'Done.' began, so it cannot cover that speech.
        self.capture.observe_provider_transcript('So that is my approach.',True,start=now-4,end=now-2.5,word_end=now-2.6)
        self.assertTrue(self.capture.pending_audio)
        self.later(.15,lambda:self.capture.observe_provider_transcript('Done.',True,start=now-1.0,end=now-.5,word_end=now-.6))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([b['text'] for p,b in self.sent if p.endswith('/chunks')],['So that is my approach.','Done.'])

    async def test_an_interim_of_a_later_segment_stays_pending_after_an_earlier_final(self):
        now=time.time()
        self.capture.observe_provider_transcript('and the cache',False,start=now-.5,end=now-.1,word_end=now-.1)
        self.capture.observe_provider_transcript('First clause.',True,start=now-2,end=now-1,word_end=now-1.05)
        self.assertTrue(self.capture.pending_interim)
        self.later(.1,lambda:self.capture.observe_provider_transcript('and the cache.',True,start=now-.5,end=now,word_end=now-.05))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([b['text'] for p,b in self.sent if p.endswith('/chunks')],['First clause.','and the cache.'])

    async def test_words_after_a_mid_speech_final_inside_the_vad_tail_get_a_longer_settle(self):
        self.capture.observe_speech_start()
        self.capture.observe_provider_transcript('First clause.',True)  # VAD stays on: the learner keeps talking
        # No interim yet for the newest words when Finish arrives; it lands after the normal settle window.
        self.later(SETTLE+.02,lambda:self.capture.observe_provider_transcript('and the cache.',True))
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual([b['text'] for p,b in self.sent if p.endswith('/chunks')],['First clause.','and the cache.'])

    async def test_pause_after_skip_does_not_wait_for_skipped_speech(self):
        self.capture.observe_speech_start(); self.capture.observe_provider_transcript('uh, not sure',False)
        await self.capture.drain(self.session,'SKIP',str(uuid4()))
        loop=asyncio.get_running_loop(); start=loop.time()
        await self.capture.drain(self.session,'PAUSE',str(uuid4()))
        self.assertLess(loop.time()-start,SETTLE)
        self.assertTrue(self.capture.sealed)

    async def test_a_speech_start_processed_after_the_boundary_is_not_ongoing_speech(self):
        self.capture.attached=False
        self.capture.observe_speech_start()
        self.assertTrue(self.capture.pending_audio)
        self.assertFalse(self.capture.speech_active)

    async def test_an_interrupted_question_is_marked_asked_but_never_opens_input(self):
        self.capture.accepting=False
        class Handle:  # a SpeechHandle that Pause interrupted mid-question
            interrupted=True
            def __await__(self): return asyncio.sleep(0).__await__()
        self.session.say=Mock(return_value=Handle())
        async def asked(path,body): return state(attempt='attempt-2')['attempt']
        self.capture.send=asked
        await self.capture.activate_question(self.session,state(attempt='attempt-2'))
        self.assertFalse(self.capture.accepting)
        self.session.input.set_audio_enabled.assert_called_with(False)
        self.session.clear_user_turn.assert_not_called()

    async def test_pause_before_a_question_starts_skips_reading_it(self):
        self.capture.accepting=False
        self.capture.interrupt_speech()
        self.session.say=AsyncMock()
        async def asked(path,body): return state(attempt='attempt-2')['attempt']
        self.capture.send=asked
        await self.capture.activate_question(self.session,state(attempt='attempt-2'))
        self.session.say.assert_not_called()
        self.assertFalse(self.capture.accepting)

    def test_provider_clock_maps_audio_times_to_wall_clock(self):
        word=TimedString('cache',start_time=12.0,end_time=12.4,start_time_offset=10.0)
        alternative=Mock(start_time=11.5,end_time=12.6,words=[word])
        clock=ProviderClock(1000.0)
        self.assertEqual(clock.timing(Mock(words=None,start_time=0,end_time=0)),{})  # no offset known yet
        self.assertEqual(clock.timing(alternative),{'start':1001.5,'end':1002.6,'word_end':1002.4})

    def test_controls_cannot_inject_answer_or_extra_fields(self):
        valid={'action':'NEXT','requestId':str(uuid4())}
        self.assertEqual(parse_control(json.dumps(valid)),valid)
        self.assertTrue(parse_control(json.dumps({'action':'PAUSE','requestId':str(uuid4()),'acceptUnresolved':True}))['acceptUnresolved'])
        for value in ({**valid,'answerText':'fake'},{**valid,'action':'GRADE'},{**valid,'requestId':'bad'},[],{**valid,'acceptUnresolved':True}):
            with self.assertRaises(CaptureUnavailable):parse_control(json.dumps(value))

class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_unsupported_and_unhealthy_never_fall_back_to_sonic(self):
        with patch('voice_backends._build_nova_sonic') as sonic:
            with self.assertRaises(ValueError):await build_interview_session(VoiceBackendConfig(backend='nova-sonic'))
            with patch('voice_backends._pipeline_bedrock_health',AsyncMock(return_value=(False,{}))):
                with self.assertRaises(RuntimeError):await build_interview_session(VoiceBackendConfig(backend='pipeline-bedrock',stt_provider='transcribe',tts_provider='polly'))
            sonic.assert_not_called()

    def test_manual_has_no_llm_and_preserves_legacy_builder(self):
        cfg=VoiceBackendConfig(backend='pipeline-bedrock',stt_provider='transcribe',tts_provider='polly')
        with patch('voice_backends._build_pipeline_bedrock_stt'),patch('voice_backends._build_pipeline_bedrock_tts'),patch('voice_backends._build_pipeline_bedrock_llm') as llm,patch('voice_backends.AgentSession') as session,patch('livekit.plugins.silero.VAD.load'):
            _build_pipeline_bedrock(cfg,manual=True)
            args=session.call_args.kwargs
            self.assertIsNone(args['llm']); self.assertEqual(args['turn_handling']['turn_detection'],'manual')
            self.assertIsNone(args['user_away_timeout']); llm.assert_not_called()
            _build_pipeline_bedrock(cfg)
            self.assertNotIn('turn_detection',session.call_args.kwargs['turn_handling'])
            self.assertEqual(session.call_args.kwargs['user_away_timeout'],120.); llm.assert_called_once()

if __name__=='__main__':unittest.main()
