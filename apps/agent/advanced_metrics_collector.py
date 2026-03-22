"""
Advanced Metrics Collector for SpashtAI
Integrates audio processing, content analysis, and intelligent scoring
"""
import asyncio
import json
import logging
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Any, Optional

from audio_processor import AudioProcessor, DeliveryMetrics
from content_analyzer import ContentAnalyzer, ContentMetrics
from scoring_engine import ScoringEngine, PerformanceInsights
from metrics_collector import MetricsCollector, SessionMetrics

logger = logging.getLogger("advanced-metrics-collector")

def serialize_datetime_objects(obj):
    """Recursively serialize datetime objects and Enums in nested dictionaries/lists"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, Enum):
        return obj.value
    elif isinstance(obj, dict):
        return {key: serialize_datetime_objects(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [serialize_datetime_objects(item) for item in obj]
    else:
        return obj

@dataclass
class AdvancedSessionMetrics:
    """Complete advanced session metrics combining all analysis types"""
    session_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    
    # Basic metrics (from original collector)
    basic_metrics: Optional[SessionMetrics] = None
    
    # Advanced delivery metrics (from audio analysis)
    delivery_metrics: Optional[DeliveryMetrics] = None
    
    # Content analysis metrics (from NLP)
    content_metrics: Optional[ContentMetrics] = None
    
    # Professional insights (from scoring engine)
    performance_insights: Optional[PerformanceInsights] = None
    
    # Processing status
    audio_processed: bool = False
    content_processed: bool = False
    insights_generated: bool = False
    processing_errors: list = None
    
    def __post_init__(self):
        if self.processing_errors is None:
            self.processing_errors = []

class AdvancedMetricsCollector:
    """Advanced metrics collector integrating all analysis components"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        
        # Initialize all analysis components
        self.basic_collector = MetricsCollector(session_id)
        self.audio_processor = AudioProcessor(session_id)
        self.content_analyzer = ContentAnalyzer()
        self.scoring_engine = ScoringEngine()
        
        # Session data
        self.session_metrics = AdvancedSessionMetrics(
            session_id=session_id,
            start_time=datetime.now(timezone.utc),
            basic_metrics=self.basic_collector.session_metrics
        )
        
        # Conversation tracking for content analysis
        self.user_transcript = ""
        self.assistant_transcript = ""
        self.conversation_turns = []
        
        logger.info(f"🧠 AdvancedMetricsCollector initialized for session {session_id}")
    
    def start_session(self):
        """Start comprehensive session tracking"""
        logger.info("🚀 Starting advanced session tracking")
        
        # Start audio collection
        self.audio_processor.start_session()
        
        # Reset session state
        self.user_transcript = ""
        self.assistant_transcript = ""
        self.conversation_turns = []
        
        logger.info("✅ Advanced session tracking started")
    
    def on_metrics_collected(self, ev):
        """Handle basic LiveKit metrics events"""
        self.basic_collector.on_metrics_collected(ev)
    
    def add_conversation_turn(self, speaker: str, text: str, timestamp: Optional[float] = None):
        """Add conversation turn for all analysis types"""
        if timestamp is None:
            timestamp = time.time()
        
        # Add to basic collector
        self.basic_collector.add_conversation_turn(speaker, text, timestamp)
        
        # Accumulate transcripts for content analysis
        if speaker == 'user':
            self.user_transcript += f" {text}"
            self.conversation_turns.append(('user', text, timestamp))
        elif speaker == 'assistant':
            self.assistant_transcript += f" {text}"
            self.conversation_turns.append(('assistant', text, timestamp))
        
        logger.debug(f"📝 Added {speaker} turn for advanced analysis: {len(text)} chars")
    
    def add_audio_chunk(self, audio_data: bytes, duration: float):
        """Add audio data for delivery analysis"""
        self.audio_processor.add_audio_chunk(audio_data, duration)
    
    async def finalize_session(self, user_audio_file_path: Optional[str] = None) -> AdvancedSessionMetrics:
        """Perform complete advanced analysis and finalize session"""
        logger.info("🔬 Starting comprehensive session analysis")
        
        self.session_metrics.end_time = datetime.now(timezone.utc)
        
        try:
            # Step 1: Finalize basic metrics
            await self._finalize_basic_metrics()
            
            # Step 2: Perform audio-based delivery analysis
            await self._analyze_delivery(user_audio_file_path)
            
            # Step 3: Perform content analysis
            await self._analyze_content()
            
            # Step 4: Generate performance insights
            await self._generate_insights()
            
            logger.info("✅ Comprehensive session analysis completed")
            
        except Exception as e:
            logger.error(f"❌ Error in advanced session analysis: {e}")
            self.session_metrics.processing_errors.append(str(e))
        
        return self.session_metrics
    
    async def _finalize_basic_metrics(self):
        """Finalize basic LiveKit metrics"""
        try:
            logger.info("📊 Finalizing basic metrics")
            self.session_metrics.basic_metrics = self.basic_collector.finalize_session()
            logger.info("✅ Basic metrics finalized")
        except Exception as e:
            logger.error(f"❌ Error finalizing basic metrics: {e}")
            self.session_metrics.processing_errors.append(f"Basic metrics: {e}")
    
    async def _analyze_delivery(self, user_audio_file_path: Optional[str] = None):
        """Perform audio-based delivery analysis"""
        try:
            logger.info("🎵 Analyzing audio delivery")
            
            # Combine all conversation text for alignment
            full_transcript = ""
            for speaker, text, _ in self.conversation_turns:
                full_transcript += f"{text} "
            
            if full_transcript.strip():
                delivery_metrics = await self.audio_processor.analyze_delivery(full_transcript.strip(), user_audio_file_path)
                if delivery_metrics:
                    self.session_metrics.delivery_metrics = delivery_metrics
                    self.session_metrics.audio_processed = True
                    logger.info("✅ Audio delivery analysis completed")
                else:
                    logger.warning("⚠️ Audio delivery analysis returned no results")
            else:
                logger.warning("⚠️ No transcript available for audio analysis")
                
        except Exception as e:
            logger.error(f"❌ Error in delivery analysis: {e}")
            self.session_metrics.processing_errors.append(f"Delivery analysis: {e}")
    
    async def _analyze_content(self):
        """Perform NLP-based content analysis"""
        try:
            logger.info("📝 Analyzing content with NLP")
            
            # Analyze user content (main focus for interview coaching)
            if self.user_transcript.strip():
                user_content = self.content_analyzer.analyze_content(
                    self.user_transcript.strip(), 
                    speaker="user"
                )
                if user_content:
                    self.session_metrics.content_metrics = user_content
                    self.session_metrics.content_processed = True
                    logger.info("✅ Content analysis completed")
                else:
                    logger.warning("⚠️ Content analysis returned no results")
            else:
                logger.warning("⚠️ No user transcript available for content analysis")
                
        except Exception as e:
            logger.error(f"❌ Error in content analysis: {e}")
            self.session_metrics.processing_errors.append(f"Content analysis: {e}")
    
    async def _generate_insights(self):
        """Generate professional performance insights"""
        try:
            logger.info("🎯 Generating performance insights")
            
            # Get linguistic metrics from basic collector
            linguistic_metrics = self.session_metrics.basic_metrics.user_metrics if self.session_metrics.basic_metrics else None
            
            # Generate comprehensive insights
            insights = self.scoring_engine.calculate_comprehensive_scores(
                delivery=self.session_metrics.delivery_metrics,
                content=self.session_metrics.content_metrics,
                linguistic=linguistic_metrics
            )
            
            self.session_metrics.performance_insights = insights
            self.session_metrics.insights_generated = True
            
            logger.info(f"✅ Performance insights generated. Overall score: {insights.scores.overall:.1f}/10")
            
        except Exception as e:
            logger.error(f"❌ Error generating insights: {e}")
            self.session_metrics.processing_errors.append(f"Insights generation: {e}")
    
    def export_comprehensive_data(self) -> Dict[str, Any]:
        """Export complete session data for storage and frontend"""
        logger.info("📤 Exporting comprehensive session data")
        
        export_data = {
            "session_id": self.session_id,
            "start_time": self.session_metrics.start_time.isoformat(),
            "end_time": self.session_metrics.end_time.isoformat() if self.session_metrics.end_time else None,
            "processing_status": {
                "audio_processed": self.session_metrics.audio_processed,
                "content_processed": self.session_metrics.content_processed,
                "insights_generated": self.session_metrics.insights_generated,
                "errors": self.session_metrics.processing_errors
            }
        }
        
        # Basic metrics
        if self.session_metrics.basic_metrics:
            export_data["basic_metrics"] = serialize_datetime_objects(asdict(self.session_metrics.basic_metrics))
        
        # Delivery metrics
        if self.session_metrics.delivery_metrics:
            export_data["delivery_metrics"] = serialize_datetime_objects(asdict(self.session_metrics.delivery_metrics))
        
        # Content metrics
        if self.session_metrics.content_metrics:
            export_data["content_metrics"] = serialize_datetime_objects(asdict(self.session_metrics.content_metrics))
        
        # Performance insights
        if self.session_metrics.performance_insights:
            insights_data = serialize_datetime_objects(asdict(self.session_metrics.performance_insights))
            # Convert enums to strings for JSON serialization
            for feedback_item in insights_data.get("feedback", []):
                if "category" in feedback_item:
                    feedback_item["category"] = feedback_item["category"].value
                if "priority" in feedback_item:
                    feedback_item["priority"] = feedback_item["priority"].value
            export_data["performance_insights"] = insights_data
        
        # Conversation data
        export_data["conversation"] = [
            {
                "speaker": speaker,
                "text": text,
                "timestamp": timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp
            }
            for speaker, text, timestamp in self.conversation_turns
        ]
        
        return export_data
    
    def get_real_time_metrics(self) -> Dict[str, Any]:
        """Get current real-time metrics for live display"""
        try:
            # Get basic metrics
            basic_metrics = self.session_metrics.basic_metrics
            if not basic_metrics:
                return {}
            
            # Calculate current performance indicators
            current_metrics = {
                "session_id": self.session_id,
                "timestamp": time.time(),
                "current_metrics": {
                    "total_turns": basic_metrics.total_turns,
                    "user_wpm": basic_metrics.user_metrics.words_per_minute,
                    "user_filler_rate": basic_metrics.user_metrics.filler_word_rate,
                    "response_time_avg": basic_metrics.user_metrics.response_time_avg,
                    "conversation_latency": basic_metrics.conversation_latency_avg
                }
            }
            
            # Add delivery insights if available
            if self.session_metrics.delivery_metrics:
                delivery = self.session_metrics.delivery_metrics
                current_metrics["current_metrics"]["precise_speech_rate"] = delivery.speech_rate
                current_metrics["current_metrics"]["articulation_rate"] = delivery.articulation_rate
                current_metrics["current_metrics"]["pause_count"] = delivery.pause_count
                current_metrics["current_metrics"]["voice_quality"] = delivery.voice_quality_score
            
            # Add content insights if available
            if self.session_metrics.content_metrics:
                content = self.session_metrics.content_metrics
                current_metrics["current_metrics"]["vocabulary_sophistication"] = content.vocabulary.sophistication_score
                current_metrics["current_metrics"]["content_relevance"] = content.relevance_score
                current_metrics["current_metrics"]["confidence_language"] = content.confidence_language
            
            return current_metrics
            
        except Exception as e:
            logger.error(f"❌ Error getting real-time metrics: {e}")
            return {}
    
    async def publish_metrics_update(self, room, topic: str = "lk.metrics"):
        """Publish enhanced real-time metrics to frontend"""
        try:
            metrics_update = self.get_real_time_metrics()
            if metrics_update:
                payload = json.dumps(metrics_update)
                await room.local_participant.publish_data(
                    payload.encode('utf-8'),
                    reliable=True,
                    topic=topic
                )
                logger.debug("📡 Enhanced metrics update published")
        except Exception as e:
            logger.error(f"❌ Error publishing enhanced metrics: {e}")
    
    async def publish_final_insights(self, room, topic: str = "lk.session"):
        """Publish comprehensive final insights"""
        try:
            comprehensive_data = self.export_comprehensive_data()
            
            final_payload = {
                "type": "session_complete_advanced",
                "session_id": self.session_id,
                "comprehensive_data": comprehensive_data,
                "timestamp": time.time()
            }
            
            payload = json.dumps(final_payload)
            await room.local_participant.publish_data(
                payload.encode('utf-8'),
                reliable=True,
                topic=topic
            )
            
            logger.info("🎉 Comprehensive session insights published")
            
        except Exception as e:
            logger.error(f"❌ Error publishing final insights: {e}")
    
    async def save_to_database(self):
        """Save both basic and advanced metrics to database via server API"""
        try:
            import aiohttp
            import os
            
            SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
            
            async with aiohttp.ClientSession() as http_session:
                # 1. Save basic metrics first (includes token counts for billing)
                if self.session_metrics.basic_metrics:
                    basic = self.session_metrics.basic_metrics
                    basic_payload = {
                        # LLM/Token metrics (critical for billing)
                        "totalLlmTokens": basic.total_llm_tokens,
                        "totalLlmDuration": basic.total_llm_duration,
                        "avgTtft": basic.avg_ttft,
                        "totalTtsDuration": basic.total_tts_duration,
                        "totalTtsAudioDuration": basic.total_tts_audio_duration,
                        "avgTtsTtfb": basic.avg_tts_ttfb,
                        "totalEouDelay": basic.total_eou_delay,
                        "conversationLatencyAvg": basic.conversation_latency_avg,
                        
                        # User metrics
                        "userMetrics": {
                            "words_per_minute": basic.user_metrics.words_per_minute if basic.user_metrics else 0,
                            "filler_word_count": basic.user_metrics.filler_word_count if basic.user_metrics else 0,
                            "filler_word_rate": basic.user_metrics.filler_word_rate if basic.user_metrics else 0,
                            "average_sentence_length": basic.user_metrics.average_sentence_length if basic.user_metrics else 0,
                            "total_speaking_time": basic.user_metrics.total_speaking_time if basic.user_metrics else 0,
                            "vocabulary_diversity": basic.user_metrics.vocabulary_diversity if basic.user_metrics else 0,
                            "response_time_avg": basic.user_metrics.response_time_avg if basic.user_metrics else 0,
                        },
                        
                        # Assistant metrics
                        "assistantMetrics": {
                            "words_per_minute": basic.assistant_metrics.words_per_minute if basic.assistant_metrics else 0,
                            "filler_word_count": basic.assistant_metrics.filler_word_count if basic.assistant_metrics else 0,
                            "filler_word_rate": basic.assistant_metrics.filler_word_rate if basic.assistant_metrics else 0,
                            "average_sentence_length": basic.assistant_metrics.average_sentence_length if basic.assistant_metrics else 0,
                            "total_speaking_time": basic.assistant_metrics.total_speaking_time if basic.assistant_metrics else 0,
                            "vocabulary_diversity": basic.assistant_metrics.vocabulary_diversity if basic.assistant_metrics else 0,
                            "response_time_avg": basic.assistant_metrics.response_time_avg if basic.assistant_metrics else 0,
                        },
                        
                        "totalTurns": basic.total_turns,
                    }
                    
                    metrics_url = f"{SERVER_URL}/sessions/{self.session_id}/metrics"
                    async with http_session.post(
                        metrics_url,
                        json=basic_payload,
                        timeout=aiohttp.ClientTimeout(total=10.0)
                    ) as response:
                        if response.status in [200, 201]:
                            logger.info(f"✅ Basic metrics saved (tokens: {basic.total_llm_tokens})")
                        else:
                            error_text = await response.text()
                            logger.warning(f"⚠️ Failed to save basic metrics: HTTP {response.status}")
                            logger.debug(f"   Response: {error_text}")
                
                # 2. Save advanced metrics
                advanced_payload = {
                    "session_id": self.session_id,
                    "start_time": self.session_metrics.start_time.isoformat() if self.session_metrics.start_time else None,
                    "end_time": self.session_metrics.end_time.isoformat() if self.session_metrics.end_time else None,
                    
                    # Content metrics
                    "content_processed": self.session_metrics.content_processed,
                    "content_metrics": asdict(self.session_metrics.content_metrics) if self.session_metrics.content_metrics else None,
                    
                    # Delivery metrics
                    "audio_processed": self.session_metrics.audio_processed,
                    "delivery_metrics": asdict(self.session_metrics.delivery_metrics) if self.session_metrics.delivery_metrics else None,
                    
                    # Performance insights
                    "insights_generated": self.session_metrics.insights_generated,
                    "performance_insights": asdict(self.session_metrics.performance_insights) if self.session_metrics.performance_insights else None,
                    
                    # Processing status
                    "processing_errors": self.session_metrics.processing_errors,
                    
                    # Basic metrics for reference
                    "basic_metrics": asdict(self.session_metrics.basic_metrics) if self.session_metrics.basic_metrics else None
                }
                
                # Serialize datetime objects
                advanced_payload = serialize_datetime_objects(advanced_payload)
                
                advanced_url = f"{SERVER_URL}/sessions/{self.session_id}/advanced-metrics"
                async with http_session.post(
                    advanced_url,
                    json=advanced_payload,
                    timeout=aiohttp.ClientTimeout(total=10.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info(f"✅ Advanced metrics saved to database")
                        return True
                    else:
                        error_text = await response.text()
                        logger.warning(f"⚠️ Failed to save advanced metrics: HTTP {response.status}")
                        logger.debug(f"   Response: {error_text}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error saving metrics to database: {e}", exc_info=True)
            return False

# Export main classes
__all__ = ['AdvancedMetricsCollector', 'AdvancedSessionMetrics']
