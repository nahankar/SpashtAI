#!/usr/bin/env python3

"""
SpashtAI Voice Agent - AWS Nova Sonic with transcripts + database logging
Combines proven audio pattern with enhanced transcript handling
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

# Server configuration
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

class ConversationLogger:
    """Minimal conversation logging to server API"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def log_message(self, role: str, content: str) -> None:
        """Log conversation message to server"""
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
                    logger.info("✅ Saved %s message to database", role)
                else:
                    logger.warning("⚠️ Failed to save message: HTTP %d", response.status)
        except Exception as e:
            logger.warning("⚠️ Failed to save to database: %s", e)
    
    async def close(self):
        if self.session:
            await self.session.close()

def prewarm(proc: JobContext):
    """Prewarm function - wait for participant since we need user audio"""
    logger.info("🔥 Prewarming SpashtAI agent worker")
    logger.info("🤖 Using AUTOMATIC dispatch - agent will join all new rooms")
    # CRITICAL: Set to True so agent waits for user to join before starting
    proc.wait_for_participant = True

async def entrypoint(ctx: JobContext):
    """
    Enhanced entrypoint with transcript support
    Reference: https://docs.livekit.io/agents/integrations/realtime/nova-sonic/
    """
    
    # CRITICAL: Connect with AUDIO_ONLY subscription for voice
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Agent starting in room: {ctx.room.name}")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Participants: {len(ctx.room.remote_participants)}")
    
    # Extract or generate session ID
    session_id = None
    try:
        if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata') and ctx.job.metadata:
            metadata = json.loads(ctx.job.metadata)
            session_id = metadata.get('sessionId')
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
    
    logger.info(f"📋 Session ID: {session_id}")
    conversation_logger = ConversationLogger(session_id)
    
    try:
        # Set agent metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent metadata set")
        except Exception as e:
            logger.warning("⚠️ Failed to set metadata: %s", e)
        
        # Create AWS Nova Sonic RealtimeModel (proven pattern)
        realtime_model = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
        )
        logger.info("✅ AWS Nova Sonic model created")
        
        # Create Agent with instructions (proven pattern)
        agent = Agent(
            instructions=(
                "You are a voice assistant for SpashtAI, a platform for voice AI interviews. "
                "Your interface with users will be voice. Use short and concise responses, "
                "and avoid unpronounceable punctuation. Be helpful, encouraging, and professional. "
                "When conducting interviews, ask thoughtful questions and provide constructive feedback. "
                "You are powered by Amazon Nova Sonic."
            )
        )
        logger.info("✅ Agent created")
        
        # Create AgentSession with transcript support enabled
        session = AgentSession(
            llm=realtime_model,
            use_tts_aligned_transcript=True  # Enable transcript events
        )
        logger.info("✅ AgentSession created with transcript support")
        
        # Register event handlers for transcripts
        @session.on("conversation_item_added")
        def on_conversation_item_added(item):
            """Handle conversation items from Nova Sonic"""
            try:
                logger.info(f"🎯 Conversation item: {type(item).__name__}")
                
                # Extract role and content
                role = "unknown"
                content = ""
                
                # Handle nested item structure
                if hasattr(item, 'item'):
                    msg = item.item
                    role = getattr(msg, 'role', 'unknown')
                    content_attr = getattr(msg, 'content', [])
                elif hasattr(item, 'role'):
                    role = getattr(item, 'role', 'unknown')
                    content_attr = getattr(item, 'content', [])
                else:
                    logger.debug(f"⏭️ Unknown item structure: {item}")
                    return
                
                # Extract text from content (handle list or string)
                if isinstance(content_attr, list):
                    content = ' '.join(str(p).strip() for p in content_attr if str(p).strip())
                elif isinstance(content_attr, str):
                    content = content_attr.strip()
                else:
                    content = str(content_attr).strip()
                
                # Skip empty/invalid content
                if not content or len(content) < 3:
                    logger.debug(f"⏭️ Skipping empty content")
                    return
                
                logger.info(f"📝 {role}: {content[:100]}...")
                
                # Publish to frontend
                message_data = {
                    "type": role,
                    "text": content,
                    "final": True,
                    "id": getattr(item, 'id', f"{role}_{int(datetime.now().timestamp() * 1000)}"),
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }
                
                asyncio.create_task(ctx.room.local_participant.publish_data(
                    json.dumps(message_data).encode(),
                    topic="lk.conversation"
                ))
                
                # Log to database
                asyncio.create_task(conversation_logger.log_message(role, content))
                
            except Exception as e:
                logger.warning("⚠️ Error in conversation_item_added: %s", e)
        
        logger.info("✅ Event handlers registered")
        
        # Send ready status to frontend
        await asyncio.sleep(0.5)  # Brief delay for connection stability
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "ready",
                "agent_model": "AWS Nova Sonic",
                "timestamp": datetime.now().isoformat()
            }).encode(),
            topic="lk.control"
        )
        logger.info("✅ Sent ready status")
        
        # Start session (proven pattern - this handles everything)
        logger.info("🎯 Starting AgentSession...")
        await session.start(room=ctx.room, agent=agent)
        logger.info("🎉 Session completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e, exc_info=True)
        raise
    finally:
        await conversation_logger.close()
        logger.info("🧹 Cleanup completed")

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        )
    )