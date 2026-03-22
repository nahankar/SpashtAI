#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Pure LiveKit AgentFramework + AWS Nova Sonic
Official LiveKit patterns only, minimal custom code
"""

import asyncio
import json
import logging
import os
import aiohttp
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents import AgentSession, Agent
from livekit.plugins import aws

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

# Server configuration for conversation persistence
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")

class ConversationLogger:
    """Minimal conversation logging to server API"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def log_message(self, role: str, content: str) -> None:
        """Log conversation message to server (fire and forget)"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            payload = {
                "role": role, 
                "content": content,
                "timestamp": datetime.now().isoformat()
            }
            
            async with self.session.post(
                f"{SERVER_URL}/sessions/{self.session_id}/messages",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5.0)
            ) as response:
                if response.status == 201:
                    logger.info("✅ Successfully saved %s message to database", role)
                else:
                    logger.warning("⚠️ Failed to save message: HTTP %d", response.status)
        except Exception as e:
            logger.warning("⚠️ Failed to save message to database: %s", e)
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()

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
    
    # Initialize conversation logger with session ID from job metadata
    session_id = None
    try:
        # Extract session ID from job metadata (passed from LiveKit token)
        if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata'):
            import json
            metadata = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
            session_id = metadata.get('sessionId')
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    # Fallback to generating session ID if not found in metadata
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
    
    logger.info(f"📋 Using session ID: {session_id}")
    conversation_logger = ConversationLogger(session_id)
    
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
        
        # Add conversation logging event handlers (using sync callbacks with asyncio.create_task)
        # For AWS Nova Sonic, we need to listen to the right events - let's try multiple approaches
        
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
                    logger.info("✅ Backup logged assistant speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log agent speech: %s", e)
        
        # Send agent ready state to frontend with enhanced metadata
        try:
            # Use data channel to send state information to frontend
            await asyncio.sleep(1)  # Wait for connection to be established
            
            # Send detailed agent information
            agent_info = {
                "type": "session_state", 
                "text": "ready",
                "agent_name": "AWS Nova Sonic Agent",
                "agent_model": "AWS Nova Sonic",
                "agent_voice": "tiffany",
                "timestamp": datetime.now().isoformat()
            }
            
            await ctx.room.local_participant.publish_data(
                json.dumps(agent_info).encode(), 
                topic="lk.control"
            )
            logger.info(f"✅ Sent enhanced ready state to frontend: {agent_info}")
        except Exception as e:
            logger.warning("⚠️ Failed to send ready state: %s", e)
        
        # Start the AgentSession using the official pattern (from docs)
        logger.info("🎯 Starting AgentSession with AWS Nova Sonic...")
        
        # AWS Nova Sonic RealtimeModel doesn't have _chat_ctx like other LLMs
        # The conversation tracking is handled via the conversation_item_added event handler above
        
        await session.start(room=ctx.room, agent=agent)
        
        logger.info("🎉 AgentSession completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e)
        raise
    finally:
        # Cleanup
        await conversation_logger.close()
        logger.info("🧹 Agent cleanup completed")

if __name__ == "__main__":
    # Official LiveKit CLI runner
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # Agent name for explicit dispatch
            agent_name="spashtai-assistant",
        )
    )