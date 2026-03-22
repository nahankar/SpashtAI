"""
Comprehensive metrics collection for SpashtAI voice interviews.
Combines LiveKit built-in metrics with custom linguistic analytics.
"""
import asyncio
import json
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Any, Deque
from datetime import datetime, timezone

from livekit.agents import metrics, MetricsCollectedEvent

logger = logging.getLogger("metrics-collector")

# Common filler words for English
FILLER_WORDS = {
    'um', 'uh', 'er', 'ah', 'like', 'you know', 'so', 'well', 'actually', 
    'basically', 'literally', 'right', 'okay', 'yeah', 'hmm', 'mmm'
}

@dataclass
class LinguisticMetrics:
    """Custom linguistic analytics for interview sessions"""
    words_per_minute: float = 0.0
    filler_word_count: int = 0
    filler_word_rate: float = 0.0  # fillers per 100 words
    average_sentence_length: float = 0.0
    pause_count: int = 0
    total_speaking_time: float = 0.0
    vocabulary_diversity: float = 0.0  # unique words / total words
    response_time_avg: float = 0.0  # average time to respond after question

@dataclass
class ConversationTurn:
    """Represents a single turn in the conversation"""
    speaker: str  # 'user' or 'assistant'
    text: str
    timestamp: float
    duration: float = 0.0
    word_count: int = 0
    filler_words: List[str] = None
    
    def __post_init__(self):
        if self.filler_words is None:
            self.filler_words = []

@dataclass
class SessionMetrics:
    """Complete session metrics combining LiveKit and linguistic data"""
    session_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    
    # LiveKit built-in metrics aggregation
    total_llm_tokens: int = 0
    total_llm_duration: float = 0.0
    avg_ttft: float = 0.0  # time to first token
    total_tts_duration: float = 0.0
    total_tts_audio_duration: float = 0.0
    avg_tts_ttfb: float = 0.0  # time to first byte
    total_eou_delay: float = 0.0  # end of utterance delay
    conversation_latency_avg: float = 0.0
    
    # Custom linguistic metrics
    user_metrics: LinguisticMetrics = None
    assistant_metrics: LinguisticMetrics = None
    
    # Conversation data
    turns: List[ConversationTurn] = None
    total_turns: int = 0
    
    def __post_init__(self):
        if self.user_metrics is None:
            self.user_metrics = LinguisticMetrics()
        if self.assistant_metrics is None:
            self.assistant_metrics = LinguisticMetrics()
        if self.turns is None:
            self.turns = []

class MetricsCollector:
    """Collects and analyzes both LiveKit and linguistic metrics"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session_metrics = SessionMetrics(
            session_id=session_id,
            start_time=datetime.now(timezone.utc)
        )
        
        # LiveKit metrics aggregation
        self.usage_collector = metrics.UsageCollector()
        self.llm_metrics: List[Any] = []
        self.tts_metrics: List[Any] = []
        self.eou_metrics: List[Any] = []
        
        # Conversation tracking
        self.conversation_buffer: Deque[ConversationTurn] = deque(maxlen=1000)
        self.current_user_turn_start: Optional[float] = None
        self.last_assistant_response_time: Optional[float] = None
        
        # Response time tracking
        self.response_times: List[float] = []
        
        logger.info(f"🔢 MetricsCollector initialized for session {session_id}")
    
    def on_metrics_collected(self, ev: MetricsCollectedEvent):
        """Handle LiveKit metrics events"""
        try:
            # Collect usage metrics
            self.usage_collector.collect(ev.metrics)
            
            # Store specific metric types for detailed analysis
            if hasattr(ev.metrics, 'llm_metrics'):
                self.llm_metrics.append(ev.metrics.llm_metrics)
                logger.debug(f"📊 LLM metrics: tokens={ev.metrics.llm_metrics.total_tokens}, "
                           f"duration={ev.metrics.llm_metrics.duration}s, "
                           f"ttft={ev.metrics.llm_metrics.ttft}s")
                
            if hasattr(ev.metrics, 'tts_metrics'):
                self.tts_metrics.append(ev.metrics.tts_metrics)
                logger.debug(f"🔊 TTS metrics: chars={ev.metrics.tts_metrics.characters_count}, "
                           f"audio_duration={ev.metrics.tts_metrics.audio_duration}s, "
                           f"ttfb={ev.metrics.tts_metrics.ttfb}s")
                
            if hasattr(ev.metrics, 'eou_metrics'):
                self.eou_metrics.append(ev.metrics.eou_metrics)
                logger.debug(f"⏱️ EOU metrics: delay={ev.metrics.eou_metrics.end_of_utterance_delay}s")
                
            # Log the collected metrics
            metrics.log_metrics(ev.metrics)
            
        except Exception as e:
            logger.error(f"❌ Error processing metrics: {e}")
    
    def add_conversation_turn(self, speaker: str, text: str, timestamp: Optional[float] = None):
        """Add a conversation turn and calculate linguistic metrics"""
        if timestamp is None:
            timestamp = time.time()
            
        # Create turn object
        turn = ConversationTurn(
            speaker=speaker,
            text=text.strip(),
            timestamp=timestamp
        )
        
        # Calculate basic metrics for this turn
        words = self._extract_words(text)
        turn.word_count = len(words)
        turn.filler_words = [word for word in words if word.lower() in FILLER_WORDS]
        
        # Track response times
        if speaker == 'user':
            self.current_user_turn_start = timestamp
        elif speaker == 'assistant' and self.current_user_turn_start:
            response_time_delta = timestamp - self.current_user_turn_start
            response_time_seconds = response_time_delta.total_seconds()
            self.response_times.append(response_time_seconds)
            self.current_user_turn_start = None
            logger.debug(f"⚡ Response time: {response_time_seconds:.2f}s")
        
        # Add to conversation buffer
        self.conversation_buffer.append(turn)
        self.session_metrics.turns.append(turn)
        self.session_metrics.total_turns += 1
        
        logger.debug(f"💬 Added {speaker} turn: {len(words)} words, "
                    f"{len(turn.filler_words)} fillers - {text[:50]}...")
    
    def _extract_words(self, text: str) -> List[str]:
        """Extract words from text, handling punctuation and contractions"""
        # Remove punctuation but keep contractions
        cleaned = re.sub(r"[^\w\s']", " ", text)
        words = cleaned.split()
        return [word.strip("'") for word in words if word.strip("'")]
    
    def _calculate_linguistic_metrics(self, turns: List[ConversationTurn]) -> LinguisticMetrics:
        """Calculate linguistic metrics for a set of turns"""
        if not turns:
            return LinguisticMetrics()
        
        total_words = sum(turn.word_count for turn in turns)
        total_filler_words = sum(len(turn.filler_words) for turn in turns)
        
        # Calculate speaking time (estimate based on average speaking rate)
        # Assuming ~150 words per minute average speaking rate
        estimated_speaking_time = (total_words / 150.0) * 60.0  # seconds
        
        # Words per minute
        wpm = (total_words / (estimated_speaking_time / 60.0)) if estimated_speaking_time > 0 else 0
        
        # Filler word rate (per 100 words)
        filler_rate = (total_filler_words / total_words * 100) if total_words > 0 else 0
        
        # Average sentence length (approximate by splitting on sentence endings)
        sentences = []
        for turn in turns:
            sentences.extend(re.split(r'[.!?]+', turn.text))
        sentences = [s.strip() for s in sentences if s.strip()]
        avg_sentence_length = sum(len(self._extract_words(s)) for s in sentences) / len(sentences) if sentences else 0
        
        # Vocabulary diversity (unique words / total words)
        all_words = []
        for turn in turns:
            all_words.extend(self._extract_words(turn.text.lower()))
        unique_words = set(all_words)
        vocab_diversity = len(unique_words) / len(all_words) if all_words else 0
        
        return LinguisticMetrics(
            words_per_minute=wpm,
            filler_word_count=total_filler_words,
            filler_word_rate=filler_rate,
            average_sentence_length=avg_sentence_length,
            total_speaking_time=estimated_speaking_time,
            vocabulary_diversity=vocab_diversity,
            response_time_avg=sum(self.response_times) / len(self.response_times) if self.response_times else 0
        )
    
    def finalize_session(self) -> SessionMetrics:
        """Calculate final metrics and return complete session data"""
        self.session_metrics.end_time = datetime.now(timezone.utc)
        
        # Aggregate LiveKit metrics
        if self.llm_metrics:
            self.session_metrics.total_llm_tokens = sum(m.total_tokens for m in self.llm_metrics)
            self.session_metrics.total_llm_duration = sum(m.duration for m in self.llm_metrics)
            self.session_metrics.avg_ttft = sum(m.ttft for m in self.llm_metrics) / len(self.llm_metrics)
        
        # If no LLM token metrics (Nova Sonic doesn't report them), estimate from text
        if self.session_metrics.total_llm_tokens == 0 and self.session_metrics.turns:
            total_chars = sum(len(turn.text) for turn in self.session_metrics.turns)
            # Rough estimation: 1 token ≈ 4 characters for English
            estimated_tokens = total_chars // 4
            self.session_metrics.total_llm_tokens = estimated_tokens
            logger.info(f"💡 Estimated LLM tokens: {estimated_tokens} (based on {total_chars} characters)")
        
        if self.tts_metrics:
            self.session_metrics.total_tts_duration = sum(m.duration for m in self.tts_metrics)
            self.session_metrics.total_tts_audio_duration = sum(m.audio_duration for m in self.tts_metrics)
            self.session_metrics.avg_tts_ttfb = sum(m.ttfb for m in self.tts_metrics) / len(self.tts_metrics)
        
        if self.eou_metrics:
            self.session_metrics.total_eou_delay = sum(m.end_of_utterance_delay for m in self.eou_metrics)
        
        # Calculate conversation latency (EOU + TTFT + TTS TTFB)
        if self.eou_metrics and self.llm_metrics and self.tts_metrics:
            latencies = []
            for eou, llm, tts in zip(self.eou_metrics, self.llm_metrics, self.tts_metrics):
                latency = eou.end_of_utterance_delay + llm.ttft + tts.ttfb
                latencies.append(latency)
            self.session_metrics.conversation_latency_avg = sum(latencies) / len(latencies)
        
        # Calculate linguistic metrics by speaker
        user_turns = [turn for turn in self.session_metrics.turns if turn.speaker == 'user']
        assistant_turns = [turn for turn in self.session_metrics.turns if turn.speaker == 'assistant']
        
        self.session_metrics.user_metrics = self._calculate_linguistic_metrics(user_turns)
        self.session_metrics.assistant_metrics = self._calculate_linguistic_metrics(assistant_turns)
        
        # Get usage summary
        usage_summary = self.usage_collector.get_summary()
        
        logger.info(f"📈 Session {self.session_id} finalized:")
        logger.info(f"  💬 Total turns: {self.session_metrics.total_turns}")
        logger.info(f"  🔢 User WPM: {self.session_metrics.user_metrics.words_per_minute:.1f}")
        logger.info(f"  🎯 User filler rate: {self.session_metrics.user_metrics.filler_word_rate:.1f}%")
        logger.info(f"  ⚡ Avg response time: {self.session_metrics.user_metrics.response_time_avg:.2f}s")
        logger.info(f"  🔄 Avg conversation latency: {self.session_metrics.conversation_latency_avg:.2f}s")
        logger.info(f"  💰 Usage summary: {usage_summary}")
        
        return self.session_metrics
    
    def export_transcript(self) -> Dict[str, Any]:
        """Export complete transcript with metadata"""
        return {
            "session_id": self.session_id,
            "start_time": self.session_metrics.start_time.isoformat(),
            "end_time": self.session_metrics.end_time.isoformat() if self.session_metrics.end_time else None,
            "total_turns": self.session_metrics.total_turns,
            "conversation": [
                {
                    "speaker": turn.speaker,
                    "text": turn.text,
                    "timestamp": turn.timestamp,
                    "word_count": turn.word_count,
                    "filler_words": turn.filler_words
                }
                for turn in self.session_metrics.turns
            ],
            "metrics": {
                "livekit": {
                    "total_llm_tokens": self.session_metrics.total_llm_tokens,
                    "total_llm_duration": self.session_metrics.total_llm_duration,
                    "avg_ttft": self.session_metrics.avg_ttft,
                    "total_tts_duration": self.session_metrics.total_tts_duration,
                    "avg_tts_ttfb": self.session_metrics.avg_tts_ttfb,
                    "conversation_latency_avg": self.session_metrics.conversation_latency_avg
                },
                "linguistic": {
                    "user": asdict(self.session_metrics.user_metrics),
                    "assistant": asdict(self.session_metrics.assistant_metrics)
                }
            }
        }
    
    async def publish_metrics_update(self, room, topic: str = "lk.metrics"):
        """Publish current metrics to the frontend"""
        try:
            # Create a lightweight metrics update
            metrics_update = {
                "session_id": self.session_id,
                "timestamp": time.time(),
                "current_metrics": {
                    "total_turns": self.session_metrics.total_turns,
                    "user_wpm": self.session_metrics.user_metrics.words_per_minute,
                    "user_filler_rate": self.session_metrics.user_metrics.filler_word_rate,
                    "response_time_avg": (sum(self.response_times) / len(self.response_times)) if self.response_times else 0,
                    "conversation_latency": self.session_metrics.conversation_latency_avg
                }
            }
            
            payload = json.dumps(metrics_update)
            await room.local_participant.publish_data(
                payload.encode('utf-8'),
                reliable=True,
                topic=topic
            )
            
        except Exception as e:
            logger.error(f"❌ Error publishing metrics update: {e}")
