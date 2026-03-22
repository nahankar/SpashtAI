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

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents.voice.agent_session import AgentSession
from livekit.plugins import aws

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.DEBUG)

class ConversationLogger:
    """Simple conversation logger for API storage"""
    def __init__(self, room_name: str):
        self.room_name = room_name
    
    async def log_message(self, role: str, content: str):
        """Log message to conversation API (placeholder for now)"""
        try:
            logger.debug(f"📝 Would log to API: {role}: {content[:50]}...")
        except Exception as e:
            logger.warning("Failed to log conversation: %s", e)

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
        
        # Set agent participant name and metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent name and metadata set for frontend identification")
        except Exception as e:
            logger.warning("⚠️ Failed to set agent metadata: %s", e)
        
        # Add conversation logging event handlers (using sync callbacks with asyncio.create_task)
        # For AWS Nova Sonic, we need to listen to the right events
        
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
        
        @session.on("user_speech_committed")
        def on_user_speech(event):
            """Handle user speech events (backup - conversation_item_added should handle most cases)"""
            try:
                logger.info(f"🎯 User speech committed event fired: {event}")
                # This is a backup handler - conversation_item_added should handle most cases
                # Only log if we get useful text content
                text = str(event) if hasattr(event, '__str__') and str(event) not in ['<class', 'object'] else None
                if text and len(text) > 10:  # Only process meaningful text
                    asyncio.create_task(conversation_logger.log_message("user", text))
                    logger.info("✅ Backup logged user speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log user speech: %s", e)
        
        @session.on("agent_speech_committed") 
        def on_agent_speech(event):
            """Handle agent speech events (backup - conversation_item_added should handle most cases)"""
            try:
                logger.info(f"🎯 Agent speech committed event fired: {event}")
                # This is a backup handler - conversation_item_added should handle most cases
                # Only log if we get useful text content
                text = str(event) if hasattr(event, '__str__') and str(event) not in ['<class', 'object'] else None
                if text and len(text) > 10:  # Only process meaningful text
                    asyncio.create_task(conversation_logger.log_message("assistant", text))
                    logger.info("✅ Backup logged agent speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log agent speech: %s", e)
        
        # Publish agent ready state
        agent_state_data = {
            "type": "session_state",
            "text": "ready",
            "agent_name": "AWS Nova Sonic Agent",
            "agent_model": "AWS Nova Sonic",
            "agent_voice": "tiffany",
            "timestamp": datetime.now().isoformat()
        }
        
        await ctx.room.local_participant.publish_data(
            json.dumps(agent_state_data).encode(),
            topic="lk.control"
        )
        
        logger.info("🎯 Agent ready state published to frontend")
        
        # Start session with pure LiveKit patterns
        logger.info("🎤 Starting AgentSession...")
        await session.start(llm, ctx.room)
        
        logger.info("✅ SpashtAI agent session completed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Agent session interrupted by user")
    except Exception as e:
        logger.error("❌ Error in agent session: %s", e, exc_info=True)
    finally:
        # Cleanup
        logger.info("🧹 Agent session cleanup completed")

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )