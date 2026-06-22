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
from turn_metrics import TurnStitcher, compute_turn_metrics, TurnMetricsSnapshot

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

        # Real (measured) speaking durations — populated externally from
        # LivePacingTracker via `set_measured_speaking_seconds`. When unset,
        # WPM falls back to deriving from session wall-clock duration rather
        # than the previous tautological 150-WPM assumption.
        self._user_speaking_seconds_measured: Optional[float] = None
        self._assistant_speaking_seconds_measured: Optional[float] = None

        self._utterance_peeker = None
        self._on_user_turn_metrics = None
        self._on_turn_committed = None
        self._stitcher = TurnStitcher(metrics_for_user=self._compute_user_turn_metrics)
        
        logger.info(f"🔢 MetricsCollector initialized for session {session_id}")

    def set_utterance_peeker(self, peeker) -> None:
        """Callable returning UtteranceSnapshot | None from LivePacingTracker."""
        self._utterance_peeker = peeker

    def set_user_turn_metrics_callback(self, callback) -> None:
        """Called with (stitched_text, TurnMetricsSnapshot) when a user turn completes."""
        self._on_user_turn_metrics = callback

    def set_turn_committed_callback(self, callback) -> None:
        """Called with (speaker, stitched_text) when any logical turn completes."""
        self._on_turn_committed = callback

    def _compute_user_turn_metrics(self, text: str, _unused) -> TurnMetricsSnapshot:
        utt = self._utterance_peeker() if self._utterance_peeker else None
        return compute_turn_metrics(
            text,
            utterance_words=utt.words if utt else None,
            utterance_seconds=utt.seconds if utt else None,
            utterance_wpm=utt.wpm if utt else None,
        )

    def ingest_conversation_fragment(
        self,
        speaker: str,
        text: str,
        timestamp: Optional[float] = None,
    ) -> None:
        """Ingest a transcript fragment; commits logical turns when role/gap boundaries cross."""
        if timestamp is None:
            timestamp = time.time()
        for committed in self._stitcher.ingest(speaker, text, timestamp):
            self._apply_committed_turn(*committed, timestamp=timestamp)

    def finalize_stitched_turns(self) -> None:
        """Flush any pending stitched turn at session end."""
        for committed in self._stitcher.flush():
            self._apply_committed_turn(*committed, timestamp=time.time())

    def _apply_committed_turn(
        self,
        speaker: str,
        text: str,
        user_metrics: Optional[TurnMetricsSnapshot],
        *,
        timestamp: float,
    ) -> None:
        self._add_committed_turn(speaker, text, timestamp)
        if self._on_turn_committed:
            try:
                self._on_turn_committed(speaker, text)
            except Exception as e:
                logger.warning("turn committed callback failed: %s", e)
        if speaker == "user" and user_metrics and self._on_user_turn_metrics:
            try:
                self._on_user_turn_metrics(text, user_metrics)
            except Exception as e:
                logger.warning("user turn metrics callback failed: %s", e)

    def add_conversation_turn(self, speaker: str, text: str, timestamp: Optional[float] = None):
        """Legacy entry point — routes through turn stitcher."""
        self.ingest_conversation_fragment(speaker, text, timestamp)

    def _add_committed_turn(self, speaker: str, text: str, timestamp: Optional[float] = None):
        """Record one logical conversational turn after stitching."""
        if timestamp is None:
            timestamp = time.time()

        turn = ConversationTurn(
            speaker=speaker,
            text=text.strip(),
            timestamp=timestamp,
        )

        words = self._extract_words(text)
        turn.word_count = len(words)
        turn.filler_words = [word for word in words if word.lower() in FILLER_WORDS]

        if speaker == "user":
            self.current_user_turn_start = timestamp
        elif speaker == "assistant" and self.current_user_turn_start:
            response_time_seconds = float(timestamp - self.current_user_turn_start)
            self.response_times.append(response_time_seconds)
            self.current_user_turn_start = None
            logger.debug(f"⚡ Response time: {response_time_seconds:.2f}s")

        self.conversation_buffer.append(turn)
        self.session_metrics.turns.append(turn)
        self.session_metrics.total_turns = len(self.session_metrics.turns)

        logger.debug(
            f"💬 Committed {speaker} turn: {len(words)} words, "
            f"{len(turn.filler_words)} fillers - {text[:50]}..."
        )

    def set_measured_speaking_seconds(
        self,
        user_seconds: Optional[float] = None,
        assistant_seconds: Optional[float] = None,
    ) -> None:
        """Record real audio-grounded speaking durations (in seconds)."""
        if user_seconds is not None and user_seconds > 0:
            self._user_speaking_seconds_measured = float(user_seconds)
        if assistant_seconds is not None and assistant_seconds > 0:
            self._assistant_speaking_seconds_measured = float(assistant_seconds)

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
    
    def _extract_words(self, text: str) -> List[str]:
        """Extract words from text, handling punctuation and contractions"""
        # Remove punctuation but keep contractions
        cleaned = re.sub(r"[^\w\s']", " ", text)
        words = cleaned.split()
        return [word.strip("'") for word in words if word.strip("'")]
    
    def _calculate_linguistic_metrics(self, turns: List[ConversationTurn]) -> LinguisticMetrics:
        """Calculate linguistic metrics for a set of turns.

        WPM is derived in this priority order:
          1. Measured speaking time (from `LivePacingTracker`) if set via
             `set_measured_speaking_seconds`. This is the audio-grounded value.
          2. Sum of per-turn `duration` fields if any turn has been populated.
          3. Session wall-clock duration as a coarse fallback.
          4. Zero — *never* the old tautological 150-WPM estimate.
        """
        if not turns:
            return LinguisticMetrics()
        
        total_words = sum(turn.word_count for turn in turns)
        total_filler_words = sum(len(turn.filler_words) for turn in turns)

        # Decide which speaker we're computing for (user vs assistant) — used
        # to pick the right measured duration from the tracker.
        speaker = turns[0].speaker if turns else "user"
        measured = (
            self._user_speaking_seconds_measured
            if speaker == "user"
            else self._assistant_speaking_seconds_measured
        )

        if measured and measured > 0:
            total_speaking_time = measured
            source = "measured"
        else:
            # Fallback 1: sum per-turn durations if populated by the entrypoint.
            per_turn_sum = sum((t.duration or 0.0) for t in turns)
            if per_turn_sum > 0:
                total_speaking_time = per_turn_sum
                source = "per-turn"
            else:
                # Fallback 2: session wall-clock — better than the old tautology
                # because at least it's a real signal, even if it overstates
                # speaking time by including silences.
                start = self.session_metrics.start_time
                end = self.session_metrics.end_time or datetime.now(timezone.utc)
                wall_clock = (end - start).total_seconds() if start else 0.0
                # Apply a simple speaker share: if both user+assistant turns are
                # in this collector's flow, assume each took ~half. This is the
                # weakest signal — caller should set measured values.
                if wall_clock > 0:
                    total_speaking_time = wall_clock * 0.5
                    source = "wall-clock-halved"
                else:
                    total_speaking_time = 0.0
                    source = "none"
        
        # Words per minute — guard against div-by-zero. No more 150-by-default.
        wpm = (total_words / total_speaking_time) * 60.0 if total_speaking_time > 0 else 0.0
        
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

        logger.info(
            "📐 %s metrics: %d words / %.2fs (%s) → %.1f WPM",
            speaker, total_words, total_speaking_time, source, wpm,
        )
        
        return LinguisticMetrics(
            words_per_minute=wpm,
            filler_word_count=total_filler_words,
            filler_word_rate=filler_rate,
            average_sentence_length=avg_sentence_length,
            total_speaking_time=total_speaking_time,
            vocabulary_diversity=vocab_diversity,
            response_time_avg=sum(self.response_times) / len(self.response_times) if self.response_times else 0
        )
    
    def finalize_session(self) -> SessionMetrics:
        """Calculate final metrics and return complete session data"""
        self.finalize_stitched_turns()
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
    
    def attach_pacing_tracker(self, tracker) -> None:
        """Attach a `LivePacingTracker` so live WPM uses real audio durations."""
        self._pacing_tracker = tracker

    def _live_user_pacing(self) -> tuple[float, int, float, str]:
        """Return (wpm, total_words, total_speaking_seconds, qualitative).

        Pulled from the attached `LivePacingTracker` when present, with a
        defensive fallback to per-turn data so the panel never goes blank.
        """
        tracker = getattr(self, "_pacing_tracker", None)
        if tracker is not None:
            snap = tracker.get_live_metrics()
            return snap.wpm, snap.total_words, snap.total_speaking_seconds, snap.qualitative

        # Fallback when tracker isn't attached (older code paths). Use the
        # most recent finalized linguistic metrics as a coarse proxy.
        user = self.session_metrics.user_metrics
        wpm = user.words_per_minute or 0.0
        words = sum(t.word_count for t in self.session_metrics.turns if t.speaker == 'user')
        secs = user.total_speaking_time or 0.0
        if wpm <= 0:
            qual = "not-enough-data"
        elif wpm < 100:
            qual = "slow"
        elif wpm < 120:
            qual = "measured"
        elif wpm <= 160:
            qual = "ideal"
        elif wpm <= 180:
            qual = "fast"
        else:
            qual = "rapid"
        return wpm, words, secs, qual

    @staticmethod
    def _build_coaching_tip(wpm: float, qualitative: str, filler_rate: float) -> str:
        """Generate a short, actionable tip for the live panel.

        Priority is filler-rate first (more disruptive to listeners), then
        pacing — but we only mention pacing once we have enough samples
        ('not-enough-data' suppresses the WPM tip).
        """
        if filler_rate >= 8:
            return "Lots of fillers — try a brief pause instead of 'um' or 'uh'."
        if qualitative == "rapid":
            return "Slow down a bit — aim for 130–150 WPM and pause before key points."
        if qualitative == "fast":
            return "A touch fast — try one deliberate pause every couple of sentences."
        if qualitative == "slow":
            return "Pick up the pace slightly — listeners stay engaged around 130 WPM."
        if qualitative == "measured":
            return "Nice steady pace — feel free to add a bit more energy on key points."
        if qualitative == "ideal":
            return "Pacing is right in the sweet spot — keep going."
        return "Keep speaking — I'll have measurements in a few seconds."

    async def publish_metrics_update(self, room, topic: str = "lk.metrics"):
        """Publish a rich live snapshot to the frontend (lk.metrics topic).

        The payload mirrors `RealTimeMetrics`'s expected shape and adds
        grounded fields (words, speaking-seconds, qualitative pace, tip).
        """
        try:
            wpm, total_words, speaking_secs, pacing_qual = self._live_user_pacing()

            # Filler stats over the whole user transcript so far.
            user_turns = [t for t in self.session_metrics.turns if t.speaker == 'user']
            cum_words = sum(t.word_count for t in user_turns) or 1
            cum_fillers = sum(len(t.filler_words) for t in user_turns)
            filler_rate = (cum_fillers / cum_words) * 100 if cum_words > 0 else 0.0

            # Vocabulary diversity (rolling) — unique / total over user turns.
            all_words = []
            for t in user_turns:
                all_words.extend(self._extract_words(t.text.lower()))
            vocab_diversity = (len(set(all_words)) / len(all_words)) if all_words else 0.0

            response_time_avg = (sum(self.response_times) / len(self.response_times)) if self.response_times else 0.0

            tip = self._build_coaching_tip(wpm, pacing_qual, filler_rate)

            metrics_update = {
                "session_id": self.session_id,
                "timestamp": time.time(),
                "current_metrics": {
                    # Original (kept for backward-compat with the existing hook).
                    "total_turns": len(self.session_metrics.turns),
                    "user_wpm": wpm,
                    "user_filler_rate": filler_rate,
                    "response_time_avg": response_time_avg,
                    "conversation_latency": self.session_metrics.conversation_latency_avg or 0.0,
                    # Enriched live fields used by the upgraded RealTimeMetrics card.
                    "user_total_words": total_words,
                    "user_speaking_seconds": speaking_secs,
                    "user_filler_count": cum_fillers,
                    "user_vocab_diversity": vocab_diversity,
                    "pacing_qualitative": pacing_qual,
                    "coaching_tip": tip,
                },
            }

            payload = json.dumps(metrics_update)
            await room.local_participant.publish_data(
                payload.encode('utf-8'),
                reliable=True,
                topic=topic,
            )
            logger.info(
                "📡 live metrics payload: %s",
                json.dumps(metrics_update["current_metrics"], default=str),
            )
            
        except Exception as e:
            logger.error(f"❌ Error publishing metrics update: {e}")
