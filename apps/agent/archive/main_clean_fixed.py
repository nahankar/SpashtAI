#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Pure LiveKit AgentFramework + AWS Nova Sonic
Official LiveKit patterns only, minimal custom code
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.agents import AgentSession, Agent
from livekit.plugins import aws

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spashtai-agent")

class ConversationLogger:
    """Simple conversation logger"""
    def __init__(self, room_name: str):
        self.room_name = room_name
        self.api_base = "http://localhost:4000"
    
    async def log_message(self, role: str, content: str):
        """Log message to backend API"""
        try:
            # For now, just log locally
            logger.info(f"💾 Conversation: {role}: {content[:100]}...")
        except Exception as e:
            logger.warning(f"⚠️ Failed to log conversation: {e}")

def prewarm(proc: JobContext):
    """Preload models - official LiveKit pattern"""
    proc.wait_for_participant = True

async def entrypoint(ctx: JobContext):
    """
    Pure LiveKit AgentFramework + AWS Nova Sonic entrypoint
    Using official VoiceAssistant pattern
    """
    # Connect with official pattern
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    environment = os.getenv("ENVIRONMENT", "development")
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Starting SpashtAI agent [{environment.upper()}] with AWS Nova Sonic")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Room: {ctx.room.name}")
    
    # Initialize conversation logger
    conversation_logger = ConversationLogger(ctx.room.name)
    
    try:
        # Create AWS Nova Sonic LLM (official pattern)
        llm = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
        )
        
        logger.info("✅ AWS Nova Sonic model created")
        
        # Create AgentSession with official LiveKit pattern (from docs example)
        session = AgentSession(
            llm=llm,  # AWS Nova Sonic RealtimeModel
            use_tts_aligned_transcript=True  # Enable TTS-aligned transcriptions (sentence-level for Nova Sonic)
        )
        
        logger.info("✅ AgentSession created with AWS Nova Sonic")
        
        # Create Agent with official LiveKit pattern
        agent = Agent(
            instructions=(
                "You are a voice assistant for SpashtAI, a platform for voice AI interviews and practice. "
                "Your interface with users will be voice. You should use short and concise responses, "
                "and avoid usage of unpronounceable punctuation. Be helpful, encouraging, and professional. "
                "When conducting interview practice, ask thoughtful questions and provide constructive feedback. "
                "You are powered by Amazon Nova Sonic for natural speech synthesis."
            )
        )
        
        logger.info("✅ Agent created with AWS Nova Sonic")
        
        # Set agent participant name and metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent name and metadata set for frontend identification")
        except Exception as e:
            logger.warning("⚠️ Failed to set agent metadata: %s", e)
        
        # Add conversation logging event handlers
        @session.on("conversation_item_added")
        def on_conversation_item_added(item):
            """Track conversation items and publish to frontend"""
            try:
                logger.info(f"🎯 Conversation item added event fired: type='{type(item).__name__}' item={item} created_at={getattr(item, 'created_at', 'unknown')}")
                
                # Extract role and content properly - handle different event types
                role = "unknown"
                content = ""
                
                # Check if it's a ChatMessage (from AWS Nova Sonic)
                if hasattr(item, 'item') and hasattr(item.item, 'role'):
                    # It's a conversation_item_added event with nested item
                    message_item = item.item
                    role = getattr(message_item, 'role', 'unknown')
                    content_attr = getattr(message_item, 'content', [])
                elif hasattr(item, 'role'):
                    # It's directly a ChatMessage
                    role = getattr(item, 'role', 'unknown')
                    content_attr = getattr(item, 'content', [])
                else:
                    logger.warning(f"🤔 Unknown item structure: {type(item)} - {item}")
                    return
                
                # Handle different content formats - AWS Nova Sonic uses content arrays
                if isinstance(content_attr, list) and len(content_attr) > 0:
                    # Join all content pieces if multiple
                    content = ' '.join(str(piece).strip() for piece in content_attr if str(piece).strip())
                elif isinstance(content_attr, str):
                    content = content_attr.strip()
                else:
                    content = str(content_attr).strip()
                
                # Debug content extraction with full details
                logger.info(f"🔍 Content extracted: role='{role}', content_attr='{content_attr}', final_content='{content}'")
                
                # Filter out empty, meaningless, or system-generated content
                if not content or content in ['[]', '', 'None', 'null'] or len(content) < 3:
                    logger.info(f"⏭️ Skipping empty/invalid conversation item: '{content}'")
                    return
                
                # Send in format expected by frontend processPayload
                message_data = {
                    "type": role,  # 'user' or 'assistant'
                    "text": content,
                    "final": True,  # Mark as final message
                    "id": getattr(item, 'id', f"{role}_{int(datetime.now().timestamp() * 1000)}"),
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }
                
                asyncio.create_task(ctx.room.local_participant.publish_data(
                    json.dumps(message_data).encode(),
                    topic="lk.conversation"
                ))
                
                # Also log to conversation API
                asyncio.create_task(conversation_logger.log_message(role, content))
                
                logger.info(f"📝 Conversation item processed: {role}: {content[:100]}...")
            except Exception as e:
                logger.warning("⚠️ Failed to process conversation item: %s", e)
        
        # Publish agent state to frontend
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "ready",
                "agent_name": "AWS Nova Sonic Agent",
                "agent_model": "AWS Nova Sonic",
                "agent_voice": "tiffany",
                "timestamp": datetime.now().isoformat()
            }).encode(),
            topic="lk.control"
        )
        
        logger.info("🚀 Starting voice assistant with AWS Nova Sonic...")
        
        # Start VoiceAssistant with official LiveKit pattern
        assistant = VoiceAssistant(session=session, agent=agent)
        await assistant.start(ctx.room)
        
        logger.info("✅ Voice assistant started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start agent: {e}")
        raise

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )