#!/usr/bin/env python3

"""
Test track egress instead of room composite egress
Track egress is lighter weight and might bypass the 503 issue
"""

import asyncio
import os
from datetime import datetime
from dotenv import load_dotenv
from livekit import api

load_dotenv()

async def test_track_egress():
    """Test track egress as alternative to room composite"""
    api_url = "http://localhost:7880"
    api_key = "devkey"
    api_secret = "devsecret"
    
    print("🔧 Testing Track Egress (lighter weight alternative)")
    print("=" * 60)
    
    lkapi = api.LiveKitAPI(url=api_url, api_key=api_key, api_secret=api_secret)
    
    try:
        # First list rooms to get an active room
        rooms_resp = await lkapi.room.list_rooms(api.ListRoomsRequest(names=[]))
        if not rooms_resp.rooms:
            print("❌ No active rooms found")
            return
        
        room = rooms_resp.rooms[0]
        print(f"🏠 Testing with room: {room.name}")
        
        # Try track egress instead of room composite
        filepath = f"/tmp/egress_track_test_{int(datetime.now().timestamp())}.ogg"
        
        # Track egress request - simpler than room composite
        req = api.TrackEgressRequest(
            room_name=room.name,
            track_id="",  # Empty means first available audio track
            file_output=api.EncodedFileOutput(
                file_type=api.EncodedFileType.OGG,
                filepath=filepath,
            )
        )
        
        print(f"🚀 Starting track egress...")
        print(f"📁 Output: {filepath}")
        
        res = await lkapi.egress.start_track_egress(req)
        print(f"✅ Track egress started successfully!")
        print(f"📋 Egress ID: {res.egress_id}")
        
        # Stop it immediately for testing
        await asyncio.sleep(2)
        await lkapi.egress.stop_egress(res.egress_id)
        print(f"🛑 Track egress stopped")
        
    except Exception as e:
        print(f"❌ Track egress failed: {type(e).__name__}: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        
        # Try to provide specific diagnosis
        error_str = str(e).lower()
        if "no response from servers" in error_str or "503" in error_str:
            print("🔍 DIAGNOSIS: Same 503 error - egress service communication issue")
        elif "track not found" in error_str:
            print("🔍 DIAGNOSIS: No audio tracks available in room")
        
    finally:
        await lkapi.aclose()

if __name__ == "__main__":
    asyncio.run(test_track_egress())