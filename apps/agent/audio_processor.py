"""
Advanced Audio Processing Pipeline for SpashtAI
Integrates with Gentle forced alignment, Praat prosodic analysis, and S3 storage
"""
import asyncio
import logging
import io
import json
import tempfile
import wave
import subprocess
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import numpy as np
from audio_storage import get_storage_instance, AudioMetadata

logger = logging.getLogger("audio-processor")

def convert_to_wav(input_path: str, output_path: Optional[str] = None) -> str:
    """
    Convert audio/video file to WAV format using ffmpeg
    
    Args:
        input_path: Path to input audio/video file (MP4, M4A, etc.)
        output_path: Optional output path. If None, creates temp file.
    
    Returns:
        Path to output WAV file
    """
    try:
        if output_path is None:
            temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            output_path = temp_file.name
            temp_file.close()
        
        # Convert to WAV using ffmpeg
        # -y: overwrite output file
        # -i: input file
        # -ar 16000: sample rate 16kHz (good for speech)
        # -ac 1: mono channel
        # -acodec pcm_s16le: 16-bit PCM encoding
        cmd = [
            'ffmpeg', '-y', '-i', input_path,
            '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le',
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60
        )
        
        if result.returncode != 0:
            error_msg = result.stderr.decode('utf-8')
            logger.error(f"❌ ffmpeg conversion failed: {error_msg}")
            raise RuntimeError(f"Audio conversion failed: {error_msg}")
        
        logger.info(f"✅ Converted {input_path} to WAV: {output_path}")
        return output_path
        
    except subprocess.TimeoutExpired:
        logger.error("❌ ffmpeg conversion timed out")
        raise RuntimeError("Audio conversion timed out after 60 seconds")
    except Exception as e:
        logger.error(f"❌ Error converting audio: {e}")
        raise

@dataclass
class WordAlignment:
    """Single word alignment result from Gentle"""
    word: str
    start: float
    end: float
    confidence: float

@dataclass
class PauseSegment:
    """Detected pause between words"""
    start: float
    end: float
    duration: float
    context_before: str
    context_after: str

@dataclass
class ProsodyMetrics:
    """Prosodic features extracted from Praat"""
    mean_pitch: float
    pitch_range: float  # max - min
    pitch_variation: float  # standard deviation
    mean_intensity: float
    intensity_stability: float  # 1/std for stability score
    harmonicity_mean: float  # voice quality
    speech_rate_precise: float  # words per minute from alignment
    articulation_rate: float  # words per minute excluding pauses

@dataclass
class DeliveryMetrics:
    """Complete delivery analysis combining alignment and prosody"""
    speech_rate: float
    articulation_rate: float
    pause_count: int
    mean_pause_duration: float
    max_pause_duration: float
    filler_word_count: int
    filler_word_rate: float  # per 100 words
    pitch_variation: float
    energy_stability: float
    voice_quality_score: float  # 0-10 based on harmonicity
    confidence_indicators: Dict[str, float]

class AudioBuffer:
    """Manages audio data collection during Nova Sonic sessions"""
    
    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.audio_chunks: List[bytes] = []
        self.total_duration = 0.0
        self.is_recording = False
    
    def start_recording(self):
        """Start collecting audio chunks"""
        self.is_recording = True
        self.audio_chunks.clear()
        self.total_duration = 0.0
        logger.info("🎤 Audio recording started")
    
    def add_chunk(self, audio_data: bytes, duration: float):
        """Add audio chunk to buffer"""
        if self.is_recording:
            self.audio_chunks.append(audio_data)
            self.total_duration += duration
    
    def stop_recording(self) -> bytes:
        """Stop recording and return complete audio"""
        self.is_recording = False
        complete_audio = b''.join(self.audio_chunks)
        logger.info(f"🎤 Audio recording stopped. Duration: {self.total_duration:.2f}s")
        return complete_audio
    
    def save_to_wav(self, filepath: str) -> str:
        """Save buffer to WAV file for processing"""
        complete_audio = b''.join(self.audio_chunks)
        
        with wave.open(filepath, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(complete_audio)
        
        return filepath
    
    async def upload_to_storage(
        self,
        session_id: str,
        user_id: str,
        participant_type: str = "user"
    ) -> Optional[AudioMetadata]:
        """Upload recorded audio to configured storage (local for dev, S3 for prod)"""
        try:
            if not self.audio_chunks:
                logger.warning("⚠️ No audio data to upload")
                return None
            
            # Convert audio chunks to WAV format
            complete_audio = b''.join(self.audio_chunks)
            
            # Create WAV file in memory
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(self.sample_rate)
                wav_file.writeframes(complete_audio)
            
            wav_data = wav_buffer.getvalue()
            
            # Upload to configured storage backend
            storage = await get_storage_instance()
            metadata = await storage.upload_audio(
                audio_data=wav_data,
                session_id=session_id,
                user_id=user_id,
                participant_type=participant_type,
                duration_seconds=self.total_duration,
                sample_rate=self.sample_rate,
                channels=1
            )
            
            logger.info(f"✅ Audio uploaded to storage: {metadata.storage_key}")
            return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to upload audio to storage: {e}")
            return None

class GentleAligner:
    """Interface to Gentle forced alignment service"""
    
    def __init__(self, gentle_url: str = "http://localhost:8765"):
        self.gentle_url = gentle_url
        self.session = None
    
    async def align(self, audio_path: str, transcript: str) -> List[WordAlignment]:
        """Perform forced alignment using Gentle service"""
        try:
            import aiohttp
            
            # Prepare multipart form data
            with open(audio_path, 'rb') as audio_file:
                form_data = aiohttp.FormData()
                form_data.add_field('audio', audio_file, filename='audio.wav')
                form_data.add_field('transcript', transcript)
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{self.gentle_url}/transcriptions", 
                        data=form_data
                    ) as response:
                        if response.status == 200:
                            result = await response.json()
                            return self._parse_gentle_response(result)
                        else:
                            logger.error(f"Gentle alignment failed: {response.status}")
                            return []
                            
        except Exception as e:
            logger.error(f"Error in Gentle alignment: {e}")
            return []
    
    def _parse_gentle_response(self, gentle_result: Dict) -> List[WordAlignment]:
        """Parse Gentle JSON response into WordAlignment objects"""
        alignments = []
        
        if 'words' in gentle_result:
            for word_data in gentle_result['words']:
                if word_data.get('case') == 'success':
                    alignments.append(WordAlignment(
                        word=word_data.get('word', ''),
                        start=word_data.get('start', 0.0),
                        end=word_data.get('end', 0.0),
                        confidence=1.0  # Gentle doesn't provide confidence scores
                    ))
        
        return alignments
    
    def extract_pauses(self, alignments: List[WordAlignment], min_pause_duration: float = 0.3) -> List[PauseSegment]:
        """Extract pause segments from word alignments"""
        pauses = []
        
        for i in range(len(alignments) - 1):
            current_end = alignments[i].end
            next_start = alignments[i + 1].start
            pause_duration = next_start - current_end
            
            if pause_duration >= min_pause_duration:
                context_before = alignments[i].word
                context_after = alignments[i + 1].word
                
                pauses.append(PauseSegment(
                    start=current_end,
                    end=next_start,
                    duration=pause_duration,
                    context_before=context_before,
                    context_after=context_after
                ))
        
        return pauses
    
    def calculate_speech_rates(self, alignments: List[WordAlignment], total_duration: float) -> Tuple[float, float]:
        """Calculate speech rate and articulation rate from alignments"""
        if not alignments:
            return 0.0, 0.0
        
        total_words = len(alignments)
        
        # Speech rate: words per minute including pauses
        speech_rate = (total_words / total_duration) * 60 if total_duration > 0 else 0
        
        # Articulation rate: words per minute excluding pauses
        total_speech_time = sum(alignment.end - alignment.start for alignment in alignments)
        articulation_rate = (total_words / total_speech_time) * 60 if total_speech_time > 0 else 0
        
        return speech_rate, articulation_rate

class PraatAnalyzer:
    """Prosodic analysis using Praat via parselmouth"""
    
    def __init__(self):
        try:
            import parselmouth
            self.praat = parselmouth
            self.available = True
            logger.info("✅ Praat analyzer initialized")
        except ImportError:
            logger.warning("⚠️ Praat (parselmouth) not available. Install with: pip install praat-parselmouth")
            self.available = False
    
    def extract_prosodic_features(self, audio_path: str, alignments: List[WordAlignment] = None) -> Optional[ProsodyMetrics]:
        """Extract prosodic features from audio file"""
        if not self.available:
            logger.warning("Praat not available, skipping prosodic analysis")
            return None
        
        try:
            sound = self.praat.Sound(audio_path)
            
            # Extract pitch (fundamental frequency)
            pitch = sound.to_pitch()
            pitch_values = pitch.selected_array['frequency']
            pitch_values = pitch_values[pitch_values > 0]  # Remove unvoiced segments
            
            # Extract intensity (loudness)
            intensity = sound.to_intensity()
            intensity_values = intensity.values.flatten()
            
            # Extract harmonicity (voice quality)
            harmonicity = sound.to_harmonicity()
            harmonicity_values = harmonicity.values.flatten()
            
            # Calculate precise speech rates if alignments available
            speech_rate_precise = 0.0
            articulation_rate = 0.0
            if alignments:
                total_duration = sound.get_total_duration()
                speech_rate_precise, articulation_rate = self._calculate_rates_from_alignment(
                    alignments, total_duration
                )
            
            return ProsodyMetrics(
                mean_pitch=float(np.mean(pitch_values)) if len(pitch_values) > 0 else 0.0,
                pitch_range=float(np.ptp(pitch_values)) if len(pitch_values) > 0 else 0.0,
                pitch_variation=float(np.std(pitch_values)) if len(pitch_values) > 0 else 0.0,
                mean_intensity=float(np.mean(intensity_values)) if len(intensity_values) > 0 else 0.0,
                intensity_stability=float(1.0 / (np.std(intensity_values) + 0.1)) if len(intensity_values) > 0 else 0.0,
                harmonicity_mean=float(np.mean(harmonicity_values[~np.isnan(harmonicity_values)])) if len(harmonicity_values) > 0 else 0.0,
                speech_rate_precise=speech_rate_precise,
                articulation_rate=articulation_rate
            )
            
        except Exception as e:
            logger.error(f"Error in Praat analysis: {e}")
            return None
    
    def _calculate_rates_from_alignment(self, alignments: List[WordAlignment], total_duration: float) -> Tuple[float, float]:
        """Calculate speech rates from word alignments"""
        if not alignments:
            return 0.0, 0.0
        
        total_words = len(alignments)
        speech_rate = (total_words / total_duration) * 60 if total_duration > 0 else 0
        
        # Calculate actual speaking time (excluding pauses)
        speaking_time = sum(alignment.end - alignment.start for alignment in alignments)
        articulation_rate = (total_words / speaking_time) * 60 if speaking_time > 0 else 0
        
        return speech_rate, articulation_rate

class AudioProcessor:
    """Main audio processing pipeline coordinator"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.audio_buffer = AudioBuffer()
        self.gentle_aligner = GentleAligner()
        self.praat_analyzer = PraatAnalyzer()
        
        # Filler words for detection in alignment
        self.filler_words = {
            'um', 'uh', 'er', 'ah', 'like', 'you know', 'so', 'well', 
            'actually', 'basically', 'literally', 'right', 'okay', 'yeah'
        }
        
        logger.info(f"🎵 AudioProcessor initialized for session {session_id}")
    
    def start_session(self):
        """Start audio collection for the session"""
        self.audio_buffer.start_recording()
    
    def add_audio_chunk(self, audio_data: bytes, duration: float):
        """Add audio chunk during session"""
        self.audio_buffer.add_chunk(audio_data, duration)
    
    async def analyze_delivery(self, transcript: str, audio_file_path: Optional[str] = None) -> Optional[DeliveryMetrics]:
        """Perform complete delivery analysis on collected audio or provided audio file"""
        logger.info(f"🔬 Starting delivery analysis for session {self.session_id}")
        
        wav_file_to_cleanup = None
        
        try:
            # Use provided audio file or fall back to audio buffer
            if audio_file_path:
                logger.info(f"📁 Using existing audio file: {audio_file_path}")
                
                # Check if file needs conversion to WAV
                if not audio_file_path.lower().endswith('.wav'):
                    logger.info(f"🔄 Converting {Path(audio_file_path).suffix} to WAV for Gentle/Praat...")
                    audio_path = convert_to_wav(audio_file_path)
                    wav_file_to_cleanup = audio_path  # Mark for cleanup
                else:
                    audio_path = audio_file_path
            else:
                # Stop recording and save audio to temporary file
                complete_audio = self.audio_buffer.stop_recording()
                
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                    audio_path = self.audio_buffer.save_to_wav(temp_file.name)
                    wav_file_to_cleanup = audio_path  # Mark for cleanup
            
            # Step 1: Forced alignment with Gentle
            logger.info("🎯 Performing forced alignment...")
            alignments = await self.gentle_aligner.align(audio_path, transcript)
            
            if not alignments:
                logger.warning("No alignment results, using basic analysis")
                return self._fallback_analysis(transcript)
            
            # Step 2: Extract pauses from alignment
            pauses = self.gentle_aligner.extract_pauses(alignments)
            
            # Step 3: Prosodic analysis with Praat
            logger.info("🎼 Performing prosodic analysis...")
            prosody = self.praat_analyzer.extract_prosodic_features(audio_path, alignments)
            
            # Step 4: Detect filler words from alignment
            filler_alignments = [a for a in alignments if a.word.lower() in self.filler_words]
            
            # Step 5: Calculate delivery metrics
            delivery_metrics = self._calculate_delivery_metrics(
                alignments, pauses, filler_alignments, prosody
            )
            
            # Cleanup converted WAV file if we created one
            if wav_file_to_cleanup:
                Path(wav_file_to_cleanup).unlink(missing_ok=True)
                logger.info(f"🗑️ Cleaned up temporary WAV file")
            
            logger.info("✅ Delivery analysis completed")
            return delivery_metrics
            
        except Exception as e:
            logger.error(f"❌ Error in delivery analysis: {e}")
            # Cleanup on error too
            if wav_file_to_cleanup:
                Path(wav_file_to_cleanup).unlink(missing_ok=True)
            return self._fallback_analysis(transcript)
    
    def _calculate_delivery_metrics(
        self,
        alignments: List[WordAlignment],
        pauses: List[PauseSegment],
        filler_alignments: List[WordAlignment],
        prosody: Optional[ProsodyMetrics]
    ) -> DeliveryMetrics:
        """Calculate comprehensive delivery metrics"""
        
        total_words = len(alignments)
        total_duration = self.audio_buffer.total_duration
        
        # Basic speech metrics
        speech_rate, articulation_rate = self.gentle_aligner.calculate_speech_rates(
            alignments, total_duration
        )
        
        # Pause analysis
        pause_durations = [p.duration for p in pauses]
        mean_pause = np.mean(pause_durations) if pause_durations else 0.0
        max_pause = max(pause_durations) if pause_durations else 0.0
        
        # Filler word analysis
        filler_count = len(filler_alignments)
        filler_rate = (filler_count / total_words * 100) if total_words > 0 else 0.0
        
        # Prosodic features (with fallbacks)
        pitch_variation = prosody.pitch_variation if prosody else 0.0
        energy_stability = prosody.intensity_stability if prosody else 5.0
        voice_quality = self._calculate_voice_quality_score(prosody) if prosody else 5.0
        
        # Confidence indicators
        confidence_indicators = {
            'pitch_range_semitones': self._hz_to_semitones(pitch_variation) if prosody else 0.0,
            'volume_consistency': energy_stability,
            'speaking_pace_stability': self._calculate_pace_stability(alignments),
            'pause_appropriateness': self._score_pause_patterns(pauses)
        }
        
        return DeliveryMetrics(
            speech_rate=speech_rate,
            articulation_rate=articulation_rate,
            pause_count=len(pauses),
            mean_pause_duration=mean_pause,
            max_pause_duration=max_pause,
            filler_word_count=filler_count,
            filler_word_rate=filler_rate,
            pitch_variation=pitch_variation,
            energy_stability=energy_stability,
            voice_quality_score=voice_quality,
            confidence_indicators=confidence_indicators
        )
    
    def _fallback_analysis(self, transcript: str) -> DeliveryMetrics:
        """Fallback analysis when advanced processing fails"""
        words = transcript.split()
        total_words = len(words)
        duration = self.audio_buffer.total_duration
        
        # Basic estimates
        speech_rate = (total_words / duration * 60) if duration > 0 else 0
        filler_count = sum(1 for word in words if word.lower() in self.filler_words)
        filler_rate = (filler_count / total_words * 100) if total_words > 0 else 0
        
        return DeliveryMetrics(
            speech_rate=speech_rate,
            articulation_rate=speech_rate * 1.2,  # Estimate
            pause_count=0,
            mean_pause_duration=0.0,
            max_pause_duration=0.0,
            filler_word_count=filler_count,
            filler_word_rate=filler_rate,
            pitch_variation=0.0,
            energy_stability=5.0,
            voice_quality_score=5.0,
            confidence_indicators={}
        )
    
    def _calculate_voice_quality_score(self, prosody: ProsodyMetrics) -> float:
        """Convert harmonicity to 0-10 voice quality score"""
        if prosody.harmonicity_mean > 10:
            return 9.0
        elif prosody.harmonicity_mean > 5:
            return 7.0
        elif prosody.harmonicity_mean > 0:
            return 5.0
        else:
            return 3.0
    
    def _hz_to_semitones(self, hz_variation: float) -> float:
        """Convert Hz pitch variation to semitones"""
        if hz_variation <= 0:
            return 0.0
        return 12 * np.log2(hz_variation / 100.0) if hz_variation > 0 else 0.0
    
    def _calculate_pace_stability(self, alignments: List[WordAlignment]) -> float:
        """Calculate stability of speaking pace (0-10 score)"""
        if len(alignments) < 2:
            return 5.0
        
        word_durations = [a.end - a.start for a in alignments]
        stability = 1.0 / (np.std(word_durations) + 0.01)
        return min(10.0, stability * 2)
    
    def _score_pause_patterns(self, pauses: List[PauseSegment]) -> float:
        """Score pause appropriateness (0-10 score)"""
        if not pauses:
            return 5.0
        
        # Ideal: 0.5-1.5s pauses, not too many
        appropriate_pauses = [p for p in pauses if 0.5 <= p.duration <= 1.5]
        appropriateness = len(appropriate_pauses) / len(pauses)
        
        return appropriateness * 10.0

# Export main classes
__all__ = [
    'AudioProcessor', 
    'DeliveryMetrics', 
    'ProsodyMetrics',
    'WordAlignment',
    'PauseSegment'
]
