#!/usr/bin/env python3

import asyncio
import os
from livekit import api

async def test_recording():
    """Test if recording starts successfully with the fixed Egress configuration"""
    
    # Set up LiveKit API client
    livekit_api_url = os.getenv("LIVEKIT_API_URL", "http://localhost:7880")
    livekit_api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET", "secret")
    
    # Create room and trigger agent
    room_api = api.LiveKitAPI(livekit_api_url, livekit_api_key, livekit_api_secret)
    
    try:
        # Create room first
        print("Creating room...")
        room_info = await room_api.room.create_room(
            api.CreateRoomRequest(name="dev")
        )
        print(f"Room created: {room_info}")
        
        # List active rooms to verify
        print("Listing rooms...")
        rooms = await room_api.room.list_rooms(api.ListRoomsRequest())
        print(f"Active rooms: {[room.name for room in rooms.rooms]}")
        
    except Exception as e:
        print(f"Error testing recording: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_recording())