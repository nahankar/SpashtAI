#!/usr/bin/env python3

"""
SpashtAI Voice Agent - AWS Nova Sonic with UI integration
Based on official LiveKit Voice AI quickstart pattern
Reference: https://docs.livekit.io/agents/start/voice-ai/
"""

import logging
import json
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, WorkerOptions, AutoSubscribe
from livekit.plugins import aws

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spashtai-agent")

# Load environment variables
load_dotenv()


def prewarm(proc):
    """Prewarm function for worker process"""
    logger.info("🔥 Prewarming SpashtAI agent worker")
    logger.info(f"🤖 Using AUTOMATIC dispatch - agent will join all new rooms")
    # DON'T set wait_for_participant - let agent join immediately when room is created
    proc.wait_for_participant = False


async def entrypoint(ctx: agents.JobContext):
    """
    Main entrypoint following official LiveKit pattern for AWS Nova Sonic
    Reference: https://docs.livekit.io/agents/integrations/realtime/nova-sonic/
    """
    try:
        # Connect with AUDIO_ONLY subscription (critical for voice conversations)
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        logger.info(f"🚀 Agent received job request for room: {ctx.room.name}")
        logger.info(f"🏠 Room participants: {len(ctx.room.remote_participants)}")
        
        # Set agent participant name for frontend identification
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent name and metadata set")
        except Exception as e:
            logger.warning(f"⚠️ Failed to set agent metadata: {e}")
        
        # OFFICIAL PATTERN: Create Agent with instructions
        # This is the critical step - the Agent must have instructions
        agent = Agent(
            instructions=(
                "You are a helpful AI interview assistant for SpashtAI platform. "
                "You conduct professional interviews, ask relevant questions, "
                "and provide constructive feedback. Be friendly, professional, and engaging. "
                "Start by greeting the candidate and asking them about their background. "
                "Listen carefully to their responses and ask thoughtful follow-up questions."
            )
        )
        logger.info("✅ Agent created with instructions")
        
        # OFFICIAL PATTERN: Create AgentSession with AWS Nova Sonic RealtimeModel
        # Nova Sonic handles STT + LLM + TTS in one integrated model
        session = AgentSession(
            llm=aws.realtime.RealtimeModel(
                region="us-east-1",
                voice="tiffany",
                temperature=0.7,
            )
        )
        logger.info("✅ AgentSession created with AWS Nova Sonic")
        
        # Send "ready" status to frontend
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "ready"
            }).encode('utf-8'),
            reliable=True,
            topic="lk.control"
        )
        logger.info("✅ Sent 'ready' status to frontend")
        
        # Set up event handlers for transcription forwarding
        @session.on("user_speech_committed")
        def on_user_speech(msg):
            """Forward user transcriptions to frontend"""
            try:
                transcript = msg.alternatives[0].text if msg.alternatives else ""
                if transcript:
                    logger.info(f"📝 User said: {transcript[:50]}...")
                    # Publish to frontend on lk.transcription topic
                    ctx.room.local_participant.publish_data(
                        json.dumps({
                            "type": "user_transcript",
                            "text": transcript,
                            "final": True
                        }).encode('utf-8'),
                        reliable=True,
                        topic="lk.transcription"
                    )
            except Exception as e:
                logger.error(f"❌ Error publishing user transcript: {e}")
        
        @session.on("agent_speech_committed")
        def on_agent_speech(msg):
            """Forward agent transcriptions to frontend"""
            try:
                transcript = msg.alternatives[0].text if msg.alternatives else ""
                if transcript:
                    logger.info(f"🤖 Agent said: {transcript[:50]}...")
                    # Publish to frontend on lk.transcription topic
                    ctx.room.local_participant.publish_data(
                        json.dumps({
                            "type": "assistant_transcript",
                            "text": transcript,
                            "final": True
                        }).encode('utf-8'),
                        reliable=True,
                        topic="lk.transcription"
                    )
            except Exception as e:
                logger.error(f"❌ Error publishing agent transcript: {e}")
        
        # OFFICIAL PATTERN: Start session with agent and room
        # Nova Sonic will automatically handle turn detection and audio streaming
        await session.start(room=ctx.room, agent=agent)
        logger.info("✅ Session started - agent is now listening and ready to speak")
        
    except Exception as e:
        logger.error(f"❌ Agent error: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    # Use automatic dispatch - agent will accept ALL job requests
    # No agent_name = truly automatic dispatch
    agents.cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # No agent_name specified = automatic dispatch to all rooms
        )
    )