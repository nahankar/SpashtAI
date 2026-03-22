Also, do we have considered, where we are storing the audio conversation as well? does the code handle, it? I suggest S3 buckets

In the below,  for the Gentle Aligner the source  should be S3 Storage? or will it take directly from Audion Chunks? Same way the Analytics dashboard the Source should be S3 Database Metadata right? Pls help check and advise

User Speech → LiveKit → AWS Nova Sonic
     ↓              ↓         ↓
Audio Chunks → Audio Buffer → S3 Storage ✅
     ↓              ↓         ↓
Gentle Aligner → Praat → Database Metadata ✅
     ↓              ↓         ↓
Analytics Dashboard ← WebSocket Updates ← Server API ✅

do you want to check our existing code and leverage the livekit.io capabilities for Text Transcripts - Saves conversation history to files

Add session keepalive logic to prevent timeouts?
Re-enable the audio recording feature (with proper fixes)?