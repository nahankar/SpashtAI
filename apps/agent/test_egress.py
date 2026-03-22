#!/usr/bin/env python3

import asyncio
import os
from livekit import api
from livekit.api import RoomCompositeEgressRequest

async def test_egress_directly():
    """Test Egress API directly to see if it responds without 503 errors"""
    
    # Set up LiveKit API client
    livekit_api_url = os.getenv("LIVEKIT_API_URL", "http://localhost:7880")
    livekit_api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET", "secret")
    
    room_api = api.LiveKitAPI(livekit_api_url, livekit_api_key, livekit_api_secret)
    
    try:
        # First ensure room exists
        print("Creating/checking room...")
        await room_api.room.create_room(api.CreateRoomRequest(name="dev"))
        
        # Try to start recording
        print("Testing Egress recording request...")
        
        request = RoomCompositeEgressRequest(
            room_name="dev",
            audio_only=True,
            file_output={"filepath": "/tmp/test_recording.wav"}
        )
        
        egress_info = await room_api.egress.start_room_composite_egress(request)
        print(f"✅ SUCCESS! Recording started: {egress_info.egress_id}")
        
        # Stop the recording immediately since this is just a test
        await room_api.egress.stop_egress(api.StopEgressRequest(egress_id=egress_info.egress_id))
        print(f"✅ Recording stopped successfully")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # Set environment variables
    os.environ["LIVEKIT_API_URL"] = "http://localhost:7880"
    os.environ["LIVEKIT_API_KEY"] = "devkey"
    os.environ["LIVEKIT_API_SECRET"] = "secret"
    
    asyncio.run(test_egress_directly())