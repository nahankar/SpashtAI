#!/usr/bin/env python3
"""
Reprocess Session Audio - CLI tool for reanalyzing existing session recordings
Usage: python reprocess_session.py <session_id> <audio_file_path> <transcript>
"""
import sys
import asyncio
import os
import logging

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from advanced_metrics_collector import AdvancedMetricsCollector

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def reprocess_session(session_id: str, audio_file_path: str, transcript: str):
    """
    Reprocess a session's audio with Gentle/Praat analysis
    
    Args:
        session_id: The session ID to reprocess
        audio_file_path: Local path to the user's audio file (MP4)
        transcript: Full user transcript text
    """
    try:
        logger.info(f"🔄 Starting reprocessing for session: {session_id}")
        logger.info(f"📁 Audio file: {audio_file_path}")
        logger.info(f"📝 Transcript length: {len(transcript)} characters")
        
        # Check if audio file exists
        if not os.path.exists(audio_file_path):
            logger.error(f"❌ Audio file not found: {audio_file_path}")
            return {"error": "Audio file not found", "success": False}
        
        # Initialize advanced metrics collector
        collector = AdvancedMetricsCollector(session_id)
        
        # Parse transcript into conversation turns (simple split for now)
        # You can enhance this to parse actual turn-by-turn data if available
        words = transcript.split()
        collector.user_transcript = transcript
        collector.conversation_turns.append(('user', transcript, 0))
        
        logger.info("🎵 Analyzing audio delivery with Gentle/Praat...")
        
        # Run delivery analysis directly
        await collector._analyze_delivery(audio_file_path)
        
        # Run content analysis
        logger.info("📚 Analyzing content with spaCy...")
        await collector._analyze_content()
        
        # Generate insights
        logger.info("💡 Generating performance insights...")
        await collector._generate_insights()
        
        # Save to database
        logger.info("💾 Saving results to database...")
        await collector.save_to_database()
        
        logger.info("✅ Reprocessing complete!")
        
        # Return summary
        delivery_metrics = collector.session_metrics.delivery_metrics
        content_metrics = collector.session_metrics.content_metrics
        
        return {
            "success": True,
            "session_id": session_id,
            "delivery_metrics": {
                "speech_rate": delivery_metrics.speech_rate if delivery_metrics else 0,
                "articulation_rate": delivery_metrics.articulation_rate if delivery_metrics else 0,
                "pause_count": delivery_metrics.pause_count if delivery_metrics else 0,
                "mean_pause_duration": delivery_metrics.mean_pause_duration if delivery_metrics else 0,
                "pitch_variation": delivery_metrics.pitch_variation if delivery_metrics else 0
            },
            "content_metrics": {
                "total_words": content_metrics.vocabulary.total_words if content_metrics and content_metrics.vocabulary else 0,
                "unique_words": content_metrics.vocabulary.unique_words if content_metrics and content_metrics.vocabulary else 0,
                "vocabulary_diversity": content_metrics.vocabulary.diversity_ratio if content_metrics and content_metrics.vocabulary else 0
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error reprocessing session: {e}", exc_info=True)
        return {"error": str(e), "success": False}

def main():
    if len(sys.argv) != 4:
        print("Usage: python reprocess_session.py <session_id> <audio_file_path> <transcript>")
        print("Example: python reprocess_session.py session_123 /path/to/user_audio.mp4 'Hello world'")
        sys.exit(1)
    
    session_id = sys.argv[1]
    audio_file_path = sys.argv[2]
    transcript = sys.argv[3]
    
    result = asyncio.run(reprocess_session(session_id, audio_file_path, transcript))
    
    import json
    print(json.dumps(result, indent=2))
    
    sys.exit(0 if result.get("success") else 1)

if __name__ == "__main__":
    main()
