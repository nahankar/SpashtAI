#!/usr/bin/env python3

"""
Debug script to test LiveKit Egress API connectivity and room visibility
Based on suggestions to isolate the egress call and capture exact error messages
"""

import asyncio
import os
import json
from datetime import datetime
from dotenv import load_dotenv
from livekit import api

load_dotenv()

async def list_rooms(api_url, api_key, api_secret):
    """List all active rooms to verify server connectivity and room visibility"""
    print(f"🔍 Testing room visibility with API URL: {api_url}")
    print(f"🔑 Using API key: {api_key[:6]}...")
    
    lkapi = api.LiveKitAPI(url=api_url, api_key=api_key, api_secret=api_secret)
    try:
        # Use the correct import - ListRoomsRequest is directly available
        res = await lkapi.room.list_rooms(api.ListRoomsRequest(names=[]))
        
        print(f"✅ Successfully connected to LiveKit API")
        print(f"📋 Found {len(res.rooms)} active rooms:")
        
        for room in res.rooms:
            print(f"  - Room: {room.name}")
            print(f"    Participants: {room.num_participants}")
            print(f"    Created: {datetime.fromtimestamp(room.creation_time)}")
            print(f"    Empty timeout: {room.empty_timeout}s")
            print()
        
        return [r.name for r in res.rooms]
        
    except Exception as e:
        print(f"❌ Failed to list rooms: {type(e).__name__}: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return []
    finally:
        await lkapi.aclose()

async def test_egress_start(api_url, api_key, api_secret, room_name):
    """Test starting egress recording with detailed error logging"""
    print(f"🎬 Testing egress start for room: {room_name}")
    
    lkapi = api.LiveKitAPI(url=api_url, api_key=api_key, api_secret=api_secret)
    try:
        # Create a minimal test recording request
        req = api.RoomCompositeEgressRequest(
            room_name=room_name,
            audio_only=True,
            file_outputs=[api.EncodedFileOutput(
                file_type=api.EncodedFileType.OGG,
                filepath=f"/tmp/egress_test_{room_name}_{int(datetime.now().timestamp())}.ogg",
            )],
        )
        
        print(f"📋 Egress request details:")
        print(f"  - Room: {req.room_name}")
        print(f"  - Audio only: {req.audio_only}")
        print(f"  - File outputs: {len(req.file_outputs)}")
        print(f"  - Output path: {req.file_outputs[0].filepath}")
        print()
        
        print("🚀 Starting egress recording...")
        res = await lkapi.egress.start_room_composite_egress(req)
        
        print(f"✅ Egress started successfully!")
        print(f"📋 Egress details:")
        print(f"  - Egress ID: {res.egress_id}")
        print(f"  - Status: {res.status}")
        print(f"  - Started at: {datetime.fromtimestamp(res.started_at / 1000000000)}")
        
        return res.egress_id
        
    except Exception as e:
        print(f"❌ Egress failed: {type(e).__name__}: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        
        # Try to extract specific Twirp error details
        if hasattr(e, 'code'):
            print(f"🔍 Twirp error code: {e.code}")
        if hasattr(e, 'message'):
            print(f"🔍 Twirp error message: {e.message}")
        if hasattr(e, 'details'):
            print(f"🔍 Twirp error details: {e.details}")
            
        return None
    finally:
        await lkapi.aclose()

async def main():
    """Main debug function"""
    print("🔧 LiveKit Egress Debug Script")
    print("=" * 50)
    
    # Get configuration from environment
    api_url = os.getenv("LIVEKIT_API_URL", "http://localhost:7880")
    api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
    api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
    
    print(f"🌍 Configuration:")
    print(f"  - API URL: {api_url}")
    print(f"  - API Key: {api_key[:6]}...")
    print(f"  - API Secret: {api_secret[:6]}...")
    print()
    
    # Step 1: List all rooms
    print("STEP 1: List all active rooms")
    print("-" * 30)
    active_rooms = await list_rooms(api_url, api_key, api_secret)
    print()
    
    # Step 2: Test egress with existing room (if any)
    if active_rooms:
        print("STEP 2: Test egress with existing room")
        print("-" * 30)
        test_room = active_rooms[0]
        egress_id = await test_egress_start(api_url, api_key, api_secret, test_room)
        
        if egress_id:
            print(f"✅ Successfully started recording with ID: {egress_id}")
            
            # Try to stop the test recording
            print(f"🛑 Stopping test recording...")
            try:
                lkapi = api.LiveKitAPI(url=api_url, api_key=api_key, api_secret=api_secret)
                await lkapi.egress.stop_egress(egress_id)
                await lkapi.aclose()
                print(f"✅ Successfully stopped test recording")
            except Exception as e:
                print(f"⚠️ Failed to stop test recording: {e}")
        else:
            print(f"❌ Failed to start egress - see error details above")
    else:
        print("STEP 2: No active rooms found - cannot test egress")
        print("-" * 30)
        print("💡 To test egress, start your agent first to create a room, then run this script")
    
    print()
    print("🏁 Debug complete")

if __name__ == "__main__":
    asyncio.run(main())