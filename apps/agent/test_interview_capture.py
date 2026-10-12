"""Provider-final speech and manual save barrier regression tests."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4
from interview_capture import InterviewCapture, CaptureUnavailable, parse_control
from voice_backends import VoiceBackendConfig, build_interview_session, _build_pipeline_bedrock

def state(index=0, attempt='attempt-1'):
    return {'nextTurnIndex':index,'segmentId':'segment-1','attempt':{'id':attempt,'status':'ASKED','question':{'text':'Explain queue retries.'}}}

class CaptureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sent=[]
        async def send(path, body):
            self.sent.append((path,body.copy()))
            return {'id':body.get('id','chunk')}
        self.send=send
        self.capture=InterviewCapture(state(),send,AsyncMock())
        self.capture.accepting=True
        self.session=Mock()
        self.session.commit_user_turn=AsyncMock(return_value='SDK promoted interim must never be saved')

    async def test_delayed_final_is_persisted_before_receipt(self):
        self.capture.observe_provider_transcript('partial',False)
        async def commit(**kwargs):
            await asyncio.sleep(0)
            self.capture.observe_provider_transcript('Actual final.',True)
        self.session.commit_user_turn.side_effect=commit
        ack=await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(ack['action'],'FINISH')
        self.assertEqual(self.sent[0][1]['text'],'Actual final.')
        self.assertEqual(self.sent[1][1]['lastTurnIndex'],0)
        self.assertFalse(self.capture.accepting)
        self.session.input.set_audio_enabled.assert_called_with(False)
        self.session.commit_user_turn.assert_called_with(transcript_timeout=8.,stt_flush_duration=2.,skip_reply=True)

    async def test_interim_and_unfinished_audio_cannot_be_saved(self):
        for observer in (lambda:self.capture.observe_provider_transcript('not final',False),self.capture.observe_speech_start):
            observer()
            with self.assertRaisesRegex(CaptureUnavailable,'TRANSCRIPT_PENDING'):
                await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(self.sent,[])

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

    async def test_silent_commit_never_saves_sdk_fallback_text(self):
        await self.capture.drain(self.session,'FINISH',str(uuid4()))
        self.assertEqual(len(self.sent),1)
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

    def test_controls_cannot_inject_answer_or_extra_fields(self):
        valid={'action':'NEXT','requestId':str(uuid4())}
        self.assertEqual(parse_control(json.dumps(valid)),valid)
        for value in ({**valid,'answerText':'fake'},{**valid,'action':'GRADE'},{**valid,'requestId':'bad'},[]):
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
