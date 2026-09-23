"""
Advanced Audio Processing Pipeline for SpashtAI
Integrates with Gentle forced alignment, Praat prosodic analysis, and S3 storage
"""
import asyncio
from difflib import SequenceMatcher
import hashlib
import logging
import io
import json
import math
import os
import re
import tempfile
import time
import wave
import subprocess
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import numpy as np
from audio_storage import get_storage_instance, AudioMetadata
from speech_patterns import analyze_speech_text

logger = logging.getLogger("audio-processor")

def wav_duration_seconds(wav_path: str) -> float:
    """Duration of a PCM WAV file in seconds."""
    try:
        with wave.open(wav_path, "rb") as wf:
            rate = wf.getframerate()
            if rate <= 0:
                return 0.0
            return wf.getnframes() / float(rate)
    except Exception as e:
        logger.warning("Could not read WAV duration from %s: %s", wav_path, e)
        return 0.0

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
    utterance_id: Optional[str] = None
    timing_origin: str = "unknown"

@dataclass
class PauseSegment:
    """Detected pause between words"""
    start: float
    end: float
    duration: float
    context_before: str
    context_after: str
    utterance_id: str

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
class DeliveryEvidence:
    """Versioned, raw evidence behind experimental delivery analysis.

    This deliberately contains observations and provenance rather than coaching
    labels or calibrated scores.  A later calibration layer may turn validated
    observations into coaching only when it has a matching model version and
    sufficient capture-quality evidence.
    """
    schema_version: int
    analyzer_version: str
    audio_input_signature: Optional[str]
    status: str
    calibration_status: str
    timing: Dict[str, object]
    acoustic: Dict[str, object]
    capture: Dict[str, object]

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
    # Legacy fields kept for old API readers. New writes leave them unscored;
    # consumers must read delivery_evidence for provenance and raw features.
    voice_quality_score: float
    confidence_indicators: Dict[str, float]
    pause_profile: List[Dict[str, object]]
    timing_origin: str
    evidence_quality: int
    aligned_word_count: int
    delivery_evidence: DeliveryEvidence

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
    
    def __init__(self, gentle_url: Optional[str] = None):
        self.gentle_url = (gentle_url or os.getenv("GENTLE_URL", "http://localhost:8765")).rstrip("/")
        self.session = None
        self.cache_dir = Path(
            os.getenv(
                "GENTLE_ALIGNMENT_CACHE_DIR",
                str(Path(__file__).resolve().parent / "audio_storage" / ".gentle-cache"),
            )
        )

    def _cache_path(self, audio_path: str, transcript: str) -> Path:
        """Content-addressed cache key; never reuse alignment for changed evidence."""
        digest = hashlib.sha256()
        digest.update(b"gentle-alignment-v2\0")
        with open(audio_path, "rb") as audio_file:
            for chunk in iter(lambda: audio_file.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
        digest.update(transcript.encode("utf-8"))
        return self.cache_dir / f"{digest.hexdigest()}.json"

    def _read_cached_alignment(self, cache_path: Path) -> Optional[List[WordAlignment]]:
        try:
            if not cache_path.exists():
                return None
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            alignments = [
                WordAlignment(
                    **{
                        **item,
                        "timing_origin": item.get("timing_origin", "forced_alignment"),
                    }
                )
                for item in payload.get("alignments", [])
            ]
            if alignments:
                logger.info("⚡ Reusing exact Gentle alignment cache: %s", cache_path.name)
                return alignments
        except Exception as e:
            logger.warning("Ignoring invalid Gentle alignment cache %s: %s", cache_path, e)
            cache_path.unlink(missing_ok=True)
        return None

    def _write_cached_alignment(
        self,
        cache_path: Path,
        alignments: List[WordAlignment],
    ) -> None:
        if not alignments:
            return
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = cache_path.with_suffix(f".{os.getpid()}.tmp")
            temp_path.write_text(
                json.dumps({"alignments": [asdict(item) for item in alignments]}),
                encoding="utf-8",
            )
            os.replace(temp_path, cache_path)
        except Exception as e:
            logger.warning("Could not save Gentle alignment cache: %s", e)

    async def is_available(self) -> bool:
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(self.gentle_url, timeout=aiohttp.ClientTimeout(total=3)) as response:
                    return response.status < 500
        except Exception:
            return False
    
    async def align(self, audio_path: str, transcript: str) -> List[WordAlignment]:
        """Perform forced alignment using Gentle service (sync mode — returns JSON, not HTML poll page)."""
        try:
            import aiohttp

            cache_path = self._cache_path(audio_path, transcript)
            cached = self._read_cached_alignment(cache_path)
            if cached is not None:
                return cached

            duration = wav_duration_seconds(audio_path)
            # Gentle can take ~1–2× realtime on CPU; floor at 120s for short clips
            timeout_sec = max(120, int(duration * 3) + 30)
            timeout = aiohttp.ClientTimeout(total=timeout_sec)

            with open(audio_path, 'rb') as audio_file:
                form_data = aiohttp.FormData()
                form_data.add_field('audio', audio_file, filename=Path(audio_path).name)
                form_data.add_field('transcript', transcript)

                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(
                        f"{self.gentle_url}/transcriptions?async=false",
                        data=form_data,
                    ) as response:
                        if response.status != 200:
                            body = await response.text()
                            logger.error(
                                "Gentle alignment failed: %s — %s",
                                response.status,
                                body[:200],
                            )
                            return []

                        content_type = response.headers.get('Content-Type', '')
                        if 'json' not in content_type:
                            body = await response.text()
                            logger.error(
                                "Gentle returned non-JSON (%s). Use ?async=false. Body: %s",
                                content_type,
                                body[:200],
                            )
                            return []

                        result = await response.json()
                        alignments = self._parse_gentle_response(result)
                        self._write_cached_alignment(cache_path, alignments)
                        return alignments

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
                        confidence=1.0,  # Gentle doesn't provide confidence scores
                        timing_origin="forced_alignment",
                    ))
        
        return alignments
    
    def extract_pauses(
        self,
        alignments: List[WordAlignment],
        min_pause_duration: float = 0.3,
        max_pause_duration: float = 3.0,
    ) -> List[PauseSegment]:
        """Extract within-utterance pauses, excluding likely inter-turn gaps."""
        pauses = []
        
        for i in range(len(alignments) - 1):
            if not self._same_utterance(alignments[i], alignments[i + 1]):
                continue
            current_end = alignments[i].end
            next_start = alignments[i + 1].start
            pause_duration = next_start - current_end
            
            if min_pause_duration <= pause_duration <= max_pause_duration:
                context_before = alignments[i].word
                context_after = alignments[i + 1].word
                
                pauses.append(PauseSegment(
                    start=current_end,
                    end=next_start,
                    duration=pause_duration,
                    context_before=context_before,
                    context_after=context_after,
                    utterance_id=alignments[i].utterance_id or "",
                ))
        
        return pauses

    @staticmethod
    def _same_utterance(current: WordAlignment, following: WordAlignment) -> bool:
        """Only explicit committed-turn identity can prove pause continuity."""
        return (
            current.utterance_id is not None
            and current.utterance_id == following.utterance_id
        )
    
    def calculate_speech_rates(self, alignments: List[WordAlignment], total_duration: float) -> Tuple[float, float]:
        """Calculate delivery speech rate and articulation rate.

        Delivery pace includes meaningful pauses up to three seconds between
        words. Longer gaps are treated as inter-turn/coach time. Articulation
        rate uses voiced word spans only.
        """
        if not alignments:
            return 0.0, 0.0
        
        total_words = len(alignments)
        
        total_speech_time = sum(alignment.end - alignment.start for alignment in alignments)
        meaningful_pause_time = sum(
            gap
            for current, following in zip(alignments, alignments[1:])
            if self._same_utterance(current, following)
            and 0 < (gap := following.start - current.end) <= 3.0
        )
        delivery_time = total_speech_time + meaningful_pause_time
        speech_rate = (total_words / delivery_time) * 60 if delivery_time > 0 else 0
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
        """Calculate delivery and articulation rates from word alignments."""
        if not alignments:
            return 0.0, 0.0
        
        total_words = len(alignments)
        speaking_time = sum(alignment.end - alignment.start for alignment in alignments)
        meaningful_pause_time = sum(
            gap
            for current, following in zip(alignments, alignments[1:])
            if GentleAligner._same_utterance(current, following)
            and 0 < (gap := following.start - current.end) <= 3.0
        )
        delivery_time = speaking_time + meaningful_pause_time
        speech_rate = (total_words / delivery_time) * 60 if delivery_time > 0 else 0
        articulation_rate = (total_words / speaking_time) * 60 if speaking_time > 0 else 0
        
        return speech_rate, articulation_rate

class AudioProcessor:
    """Main audio processing pipeline coordinator"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        # Issued by the server before analysis. It binds the observations below
        # to one exact, complete set of session segments.
        self.audio_input_signature: Optional[str] = None
        self.audio_buffer = AudioBuffer()
        self.gentle_aligner = GentleAligner()
        self.praat_analyzer = PraatAnalyzer()
        
        logger.info(f"🎵 AudioProcessor initialized for session {session_id}")
    
    def start_session(self):
        """Start audio collection for the session"""
        self.audio_buffer.start_recording()
    
    def add_audio_chunk(self, audio_data: bytes, duration: float):
        """Add audio chunk during session"""
        self.audio_buffer.add_chunk(audio_data, duration)
    
    @staticmethod
    def _validate_supplied_alignments(
        alignments: Optional[List[WordAlignment]],
        transcript: str,
        audio_duration: float,
    ) -> List[WordAlignment]:
        """Accept persisted STT words only when they form complete audio evidence."""
        if not alignments or audio_duration <= 0:
            return []
        invalid_origins = {
            item.timing_origin
            for item in alignments
            if item.timing_origin not in ("actual", "forced_alignment")
        }
        if invalid_origins:
            logger.warning(
                "Persisted STT alignment rejected: non-acoustic timing origins %s",
                sorted(invalid_origins),
            )
            return []
        transcript_tokens = [
            token.lower()
            for token in re.findall(r"[A-Za-z']+(?:[-'][A-Za-z']+)?", transcript)
        ]
        alignment_tokens = [
            token.lower()
            for item in alignments
            for token in re.findall(r"[A-Za-z']+(?:[-'][A-Za-z']+)?", item.word)
        ]
        coverage = len(alignments) / len(transcript_tokens) if transcript_tokens else 0.0
        if coverage < 0.95 or coverage > 1.05:
            logger.warning(
                "Persisted STT alignment rejected: %.1f%% transcript coverage",
                coverage * 100,
            )
            return []
        lexical_match = SequenceMatcher(
            None,
            transcript_tokens,
            alignment_tokens,
            autojunk=False,
        ).ratio()
        if lexical_match < 0.90:
            logger.warning(
                "Persisted STT alignment rejected: %.1f%% lexical match",
                lexical_match * 100,
            )
            return []

        previous_start = -1.0
        for item in alignments:
            if not all(math.isfinite(value) for value in (item.start, item.end)):
                logger.warning("Persisted STT alignment rejected: non-finite timestamp")
                return []
            if item.start < 0 or item.end < item.start:
                logger.warning("Persisted STT alignment rejected: invalid word interval")
                return []
            if item.start < previous_start:
                logger.warning("Persisted STT alignment rejected: out-of-order words")
                return []
            if item.end > audio_duration + 0.5:
                logger.warning("Persisted STT alignment rejected: word outside audio duration")
                return []
            previous_start = item.start
        return alignments

    async def analyze_delivery(
        self,
        transcript: str,
        audio_file_path: Optional[str] = None,
        supplied_alignments: Optional[List[WordAlignment]] = None,
    ) -> Optional[DeliveryMetrics]:
        """Perform complete delivery analysis on collected audio or provided audio file"""
        logger.info(f"🔬 Starting delivery analysis for session {self.session_id}")
        
        wav_file_to_cleanup = None
        audio_path: Optional[str] = None
        audio_duration = 0.0
        
        try:
            # Use provided audio file or fall back to audio buffer
            if audio_file_path:
                logger.info(f"📁 Using existing audio file: {audio_file_path}")
                
                if not Path(audio_file_path).exists():
                    logger.error(f"❌ Audio file not found: {audio_file_path}")
                    return self._fallback_analysis(transcript, audio_duration=0.0)
                
                # Convert MP3/M4A/WebM/MP4 → 16 kHz mono WAV for Gentle + Praat
                if not audio_file_path.lower().endswith('.wav'):
                    logger.info(f"🔄 Converting {Path(audio_file_path).suffix} to WAV for Gentle/Praat...")
                    audio_path = convert_to_wav(audio_file_path)
                    wav_file_to_cleanup = audio_path
                else:
                    audio_path = audio_file_path
                
                audio_duration = wav_duration_seconds(audio_path)
                logger.info(f"⏱️ Audio duration from file: {audio_duration:.2f}s")
            else:
                complete_audio = self.audio_buffer.stop_recording()
                
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                    audio_path = self.audio_buffer.save_to_wav(temp_file.name)
                    wav_file_to_cleanup = audio_path
                
                audio_duration = self.audio_buffer.total_duration or wav_duration_seconds(audio_path)
            
            if audio_duration <= 0 and audio_path:
                audio_duration = wav_duration_seconds(audio_path)
            
            normalized_transcript = (transcript or "").strip()
            if not normalized_transcript:
                logger.warning("⚠️ Empty transcript for delivery analysis")
                return None
            
            # Step 1: Forced alignment with Gentle (optional — needs docker on :8765)
            alignments = self._validate_supplied_alignments(
                supplied_alignments,
                normalized_transcript,
                audio_duration,
            )
            if alignments:
                logger.info(
                    "⚡ Using %d validated persisted STT word timestamps; Gentle not required",
                    len(alignments),
                )
            else:
                gentle_ok = await self.gentle_aligner.is_available()
                if gentle_ok:
                    logger.info("🎯 Performing forced alignment with Gentle...")
                    align_started = time.monotonic()
                    alignments = await self.gentle_aligner.align(audio_path, normalized_transcript)
                    # Gentle output (including cache entries) is still untrusted
                    # alignment evidence. Apply the same coverage, lexical, and
                    # timestamp checks used for persisted STT timings.
                    alignments = self._validate_supplied_alignments(
                        alignments,
                        normalized_transcript,
                        audio_duration,
                    )
                    logger.info(
                        "⏱️ Gentle alignment stage completed in %.2fs",
                        time.monotonic() - align_started,
                    )
                else:
                    logger.warning(
                        "⚠️ Gentle not reachable at %s — delivery pace, articulation, and pauses remain unavailable. "
                        "Start with: cd infra/gentle && docker compose up -d",
                        self.gentle_aligner.gentle_url,
                    )
            
            if not alignments:
                logger.warning("No alignment results — timing-based delivery metrics remain unavailable")
                return self._fallback_analysis(normalized_transcript, audio_duration, audio_path)
            
            # Step 2: Extract pauses from alignment
            pauses = self.gentle_aligner.extract_pauses(alignments)
            
            # Step 3: Prosodic analysis with Praat
            logger.info("🎼 Performing prosodic analysis...")
            praat_started = time.monotonic()
            prosody = self.praat_analyzer.extract_prosodic_features(audio_path, alignments)
            logger.info(
                "⏱️ Praat analysis stage completed in %.2fs",
                time.monotonic() - praat_started,
            )
            
            # Step 4: Filler counts — same strict rules as live coaching (speech_patterns)
            delivery_metrics = self._calculate_delivery_metrics(
                alignments, pauses, prosody, normalized_transcript, audio_duration
            )
            
            if wav_file_to_cleanup:
                Path(wav_file_to_cleanup).unlink(missing_ok=True)
                logger.info("🗑️ Cleaned up temporary WAV file")
            
            logger.info("✅ Delivery analysis completed")
            return delivery_metrics
            
        except Exception as e:
            logger.error(f"❌ Error in delivery analysis: {e}")
            if wav_file_to_cleanup:
                Path(wav_file_to_cleanup).unlink(missing_ok=True)
            return self._fallback_analysis(transcript, audio_duration, audio_path)
    
    def _calculate_delivery_metrics(
        self,
        alignments: List[WordAlignment],
        pauses: List[PauseSegment],
        prosody: Optional[ProsodyMetrics],
        transcript: str,
        audio_duration: float,
    ) -> DeliveryMetrics:
        """Calculate comprehensive delivery metrics"""
        
        total_words = len(alignments)
        duration = audio_duration if audio_duration > 0 else sum(a.end - a.start for a in alignments)
        
        # Speech rate from alignment timestamps over real audio duration
        speech_rate, articulation_rate = self.gentle_aligner.calculate_speech_rates(
            alignments, duration
        )
        
        # Prefer Praat-derived rates when available (more accurate)
        if prosody and prosody.speech_rate_precise > 0:
            speech_rate = prosody.speech_rate_precise
            articulation_rate = prosody.articulation_rate
        
        # Pause analysis
        pause_durations = [p.duration for p in pauses]
        mean_pause = float(np.mean(pause_durations)) if pause_durations else 0.0
        max_pause = float(max(pause_durations)) if pause_durations else 0.0
        
        # Strict filler rules — aligned with live metrics (okay/so ≠ filler)
        speech = analyze_speech_text(transcript)
        filler_count = speech.filler_count
        filler_rate = speech.filler_rate
        
        # Prosodic features are retained as raw experimental observations.  They
        # are not calibrated coaching scores: microphone choice, room acoustics,
        # and browser processing can all change them materially.
        pitch_variation = prosody.pitch_variation if prosody else 0.0
        energy_stability = prosody.intensity_stability if prosody else 0.0
        timing_origin = (
            "validated_word_timestamps"
            if all(item.timing_origin == "actual" for item in alignments)
            else "forced_alignment"
        )
        evidence_quality = 3 if timing_origin == "validated_word_timestamps" else 2
        delivery_evidence = self._build_delivery_evidence(
            transcript=transcript,
            alignments=alignments,
            pauses=pauses,
            prosody=prosody,
            timing_origin=timing_origin,
            evidence_quality=evidence_quality,
        )
        
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
            # Retained for the legacy payload shape only.  No 0-10 HNR
            # transform is emitted until a calibrated delivery model exists.
            voice_quality_score=0.0,
            confidence_indicators={},
            pause_profile=[asdict(pause) for pause in pauses],
            timing_origin=timing_origin,
            evidence_quality=evidence_quality,
            aligned_word_count=len(alignments),
            delivery_evidence=delivery_evidence,
        )
    
    def _fallback_analysis(
        self,
        transcript: str,
        audio_duration: float = 0.0,
        audio_path: Optional[str] = None,
    ) -> DeliveryMetrics:
        """Fallback without alignment: retain fillers/prosody, not timing rates."""
        speech = analyze_speech_text(transcript)
        duration = audio_duration

        if duration <= 0 and audio_path:
            duration = wav_duration_seconds(audio_path)

        prosody = None
        if audio_path and Path(audio_path).exists():
            prosody = self.praat_analyzer.extract_prosodic_features(audio_path)

        # Full-track duration contains long coach/inter-turn silences, so it is
        # not valid evidence for either delivery pace or articulation rate.
        # Keep these unavailable until alignment supplies word/ pause timing.
        speech_rate = 0.0
        articulation_rate = 0.0

        timing_origin = "prosody_only" if prosody else "unavailable"
        evidence_quality = 1 if prosody else 0
        return DeliveryMetrics(
            speech_rate=speech_rate,
            articulation_rate=articulation_rate,
            pause_count=0,
            mean_pause_duration=0.0,
            max_pause_duration=0.0,
            filler_word_count=speech.filler_count,
            filler_word_rate=speech.filler_rate,
            pitch_variation=prosody.pitch_variation if prosody else 0.0,
            energy_stability=prosody.intensity_stability if prosody else 0.0,
            voice_quality_score=0.0,
            confidence_indicators={},
            pause_profile=[],
            timing_origin=timing_origin,
            evidence_quality=evidence_quality,
            aligned_word_count=0,
            delivery_evidence=self._build_delivery_evidence(
                transcript=transcript,
                alignments=[],
                pauses=[],
                prosody=prosody,
                timing_origin=timing_origin,
                evidence_quality=evidence_quality,
            ),
        )

    def _build_delivery_evidence(
        self,
        transcript: str,
        alignments: List[WordAlignment],
        pauses: List[PauseSegment],
        prosody: Optional[ProsodyMetrics],
        timing_origin: str,
        evidence_quality: int,
    ) -> DeliveryEvidence:
        """Return a stable evidence contract without implying a clinical or social judgment."""
        transcript_words = len(re.findall(r"[A-Za-z0-9']+", transcript or ""))
        aligned_words = len(alignments)
        coverage = aligned_words / transcript_words if transcript_words else 0.0
        raw_acoustic = {
            "mean_f0_hz": prosody.mean_pitch if prosody else None,
            "f0_range_hz": prosody.pitch_range if prosody else None,
            "f0_std_hz": prosody.pitch_variation if prosody else None,
            "mean_intensity_db": prosody.mean_intensity if prosody else None,
            "intensity_stability_inverse_std": prosody.intensity_stability if prosody else None,
            "harmonicity_mean_db": prosody.harmonicity_mean if prosody else None,
        }
        return DeliveryEvidence(
            schema_version=1,
            analyzer_version="praat-raw-v1",
            audio_input_signature=self.audio_input_signature,
            status="experimental" if prosody or alignments else "insufficient_evidence",
            calibration_status="uncalibrated",
            timing={
                "source": timing_origin,
                "evidence_quality": evidence_quality,
                "aligned_word_count": aligned_words,
                "transcript_word_count": transcript_words,
                "transcript_coverage": coverage,
                "within_turn_pause_count": len(pauses),
            },
            acoustic={
                "source": "praat" if prosody else "unavailable",
                "raw_measurements": raw_acoustic,
            },
            capture={
                # The server should populate these from browser constraints in a
                # later capture-metadata pass.  Unknown must never be read as a
                # clean or neutral capture.
                "automatic_gain_control": "unknown",
                "noise_suppression": "unknown",
                "echo_cancellation": "unknown",
            },
        )

# Export main classes
__all__ = [
    'AudioProcessor', 
    'DeliveryMetrics', 
    'DeliveryEvidence',
    'ProsodyMetrics',
    'WordAlignment',
    'PauseSegment',
    'convert_to_wav',
    'wav_duration_seconds',
]
