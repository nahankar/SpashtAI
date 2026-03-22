# SpashtAI Advanced Analytics Architecture

> **Next-Generation Interview Coaching with Audio-Based Delivery Analysis**  
> **Status**: Architecture Design  
> **Goal**: Transform basic metrics into professional coaching insights

---

## Overview

Building on our existing metrics foundation, this advanced system adds:
- **Audio-based delivery analysis** (not just text-based)
- **Linguistic content analysis** with NLP
- **Composite scoring** for professional feedback
- **Actionable coaching recommendations**

---

## Architecture Design

### Phase 1: Audio Processing Pipeline

```
Nova Sonic Audio → Audio Buffer → Analysis Pipeline
                ↓
        [Gentle Aligner] → Word Timestamps
                ↓
        [Praat Analysis] → Prosodic Features
                ↓
        [Metrics Engine] → Delivery Scores
```

#### Components:

**1. Audio Capture & Storage**
```python
# apps/agent/audio_processor.py
class AudioProcessor:
    def __init__(self, session_id: str):
        self.audio_buffer = AudioBuffer()
        self.gentle_aligner = GentleAligner()
        self.praat_analyzer = PraatAnalyzer()
    
    async def process_audio_chunk(self, audio_data: bytes):
        # Store for forced alignment
        self.audio_buffer.append(audio_data)
        
    async def analyze_delivery(self, transcript: str) -> DeliveryMetrics:
        # 1. Forced alignment with Gentle
        alignment = await self.gentle_aligner.align(
            audio=self.audio_buffer.get_audio(),
            transcript=transcript
        )
        
        # 2. Prosodic analysis with Praat
        prosody = await self.praat_analyzer.extract_features(
            audio=self.audio_buffer.get_audio(),
            timestamps=alignment.word_timestamps
        )
        
        return DeliveryMetrics(
            speech_rate=alignment.calculate_speech_rate(),
            pause_lengths=alignment.extract_pauses(),
            pitch_variation=prosody.pitch_range,
            energy_stability=prosody.energy_variance,
            filler_timestamps=alignment.find_fillers()
        )
```

**2. Gentle Integration**
```dockerfile
# Docker container for Gentle
FROM lowerquality/gentle:latest
EXPOSE 8765

# API wrapper
POST /align
{
  "audio": "base64_encoded_wav",
  "transcript": "text to align"
}
```

**3. Praat Analysis**
```python
# apps/agent/praat_analyzer.py
import parselmouth
from parselmouth.praat import call

class PraatAnalyzer:
    def extract_prosodic_features(self, audio_path: str) -> ProsodyMetrics:
        sound = parselmouth.Sound(audio_path)
        
        # Pitch analysis
        pitch = sound.to_pitch()
        pitch_values = pitch.selected_array['frequency']
        
        # Energy analysis  
        intensity = sound.to_intensity()
        
        # Voice quality
        harmonicity = sound.to_harmonicity()
        
        return ProsodyMetrics(
            mean_pitch=np.mean(pitch_values[pitch_values > 0]),
            pitch_range=np.ptp(pitch_values[pitch_values > 0]),
            pitch_variation=np.std(pitch_values[pitch_values > 0]),
            mean_intensity=intensity.values.mean(),
            intensity_stability=1.0 / np.std(intensity.values),
            harmonicity_mean=harmonicity.values.mean()
        )
```

### Phase 2: Content Analysis Pipeline

```
Transcript → spaCy NLP → Content Analysis → Feedback Generation
```

**1. spaCy Integration**
```python
# apps/agent/content_analyzer.py
import spacy
from spacy import displacy

class ContentAnalyzer:
    def __init__(self):
        self.nlp = spacy.load("en_core_web_lg")
    
    def analyze_content(self, transcript: str) -> ContentMetrics:
        doc = self.nlp(transcript)
        
        # Grammar & complexity
        grammar_score = self._analyze_grammar(doc)
        complexity_score = self._analyze_complexity(doc)
        
        # Entity recognition
        entities = self._extract_entities(doc)
        
        # Sentiment analysis
        sentiment = self._analyze_sentiment(doc)
        
        return ContentMetrics(
            grammar_score=grammar_score,
            sentence_complexity=complexity_score,
            entities_mentioned=entities,
            sentiment_score=sentiment,
            vocabulary_sophistication=self._calculate_vocab_level(doc)
        )
    
    def _extract_entities(self, doc) -> Dict[str, List[str]]:
        entities = {
            'companies': [],
            'roles': [],
            'skills': [],
            'locations': []
        }
        
        for ent in doc.ents:
            if ent.label_ == "ORG":
                entities['companies'].append(ent.text)
            elif ent.label_ in ["PERSON", "TITLE"]:
                entities['roles'].append(ent.text)
            # ... more entity types
        
        return entities
```

### Phase 3: Composite Scoring System

```python
# apps/agent/scoring_engine.py
@dataclass
class CompositeScores:
    fluency: float      # 0-10 (speech rate, fillers, pauses)
    clarity: float      # 0-10 (grammar, vocabulary, structure)
    confidence: float   # 0-10 (pitch variation, volume, pace)
    impact: float       # 0-10 (sentiment, emphasis, engagement)

class ScoringEngine:
    def calculate_composite_scores(
        self, 
        delivery: DeliveryMetrics,
        content: ContentMetrics,
        linguistic: LinguisticMetrics
    ) -> CompositeScores:
        
        # Fluency Score (40% delivery, 60% linguistic)
        fluency = (
            self._score_speech_rate(delivery.speech_rate) * 0.4 +
            self._score_fillers(linguistic.filler_word_rate) * 0.3 +
            self._score_pauses(delivery.pause_lengths) * 0.3
        )
        
        # Clarity Score (70% content, 30% delivery)
        clarity = (
            content.grammar_score * 0.4 +
            self._score_vocabulary(content.vocabulary_sophistication) * 0.3 +
            self._score_structure(content.sentence_complexity) * 0.3
        )
        
        # Confidence Score (80% delivery, 20% content)
        confidence = (
            self._score_pitch_variation(delivery.pitch_variation) * 0.4 +
            self._score_volume_stability(delivery.energy_stability) * 0.4 +
            content.sentiment_score * 0.2
        )
        
        # Impact Score (balanced)
        impact = (
            self._score_engagement(content.entities_mentioned) * 0.4 +
            self._score_emphasis(delivery.pitch_variation) * 0.3 +
            content.sentiment_score * 0.3
        )
        
        return CompositeScores(
            fluency=min(10.0, fluency),
            clarity=min(10.0, clarity), 
            confidence=min(10.0, confidence),
            impact=min(10.0, impact)
        )
```

### Phase 4: Intelligent Feedback Engine

```python
# apps/agent/feedback_engine.py
class FeedbackEngine:
    def generate_feedback(
        self,
        scores: CompositeScores,
        delivery: DeliveryMetrics,
        content: ContentMetrics
    ) -> List[FeedbackItem]:
        
        feedback = []
        
        # Fluency feedback
        if scores.fluency < 6.0:
            if delivery.speech_rate < 120:
                feedback.append(FeedbackItem(
                    category="fluency",
                    priority="high",
                    message="Speak slightly faster - aim for 140-160 words per minute",
                    actionable_tip="Practice reading aloud to build natural pace"
                ))
            
            if linguistic.filler_word_rate > 5:
                feedback.append(FeedbackItem(
                    category="fluency", 
                    priority="medium",
                    message=f"Reduce filler words - you used {linguistic.filler_word_count} fillers",
                    actionable_tip="Pause silently instead of saying 'um' or 'like'"
                ))
        
        # Confidence feedback
        if scores.confidence < 6.0:
            if delivery.pitch_variation < 1.5:  # semitones
                feedback.append(FeedbackItem(
                    category="confidence",
                    priority="high", 
                    message="Vary your pitch more to sound engaging",
                    actionable_tip="Emphasize key points with higher pitch, end statements with lower pitch"
                ))
        
        # Content feedback
        if len(content.entities_mentioned['companies']) == 0:
            feedback.append(FeedbackItem(
                category="content",
                priority="medium",
                message="Mention specific companies or organizations",
                actionable_tip="Reference the company you're interviewing with and competitors"
            ))
        
        return feedback
```

---

## Implementation Plan

### **Phase 1: Foundation (Week 1-2)**
1. **Audio Buffer System**: Capture and store audio during Nova Sonic sessions
2. **Gentle Docker Setup**: Containerized forced alignment service
3. **Basic Delivery Metrics**: Speech rate, pause detection from alignment

### **Phase 2: Prosodic Analysis (Week 2-3)**
1. **Praat Integration**: Python bindings for prosodic feature extraction
2. **Voice Quality Metrics**: Pitch variation, energy stability, harmonicity
3. **Enhanced Database Schema**: Store audio-based metrics

### **Phase 3: Content Intelligence (Week 3-4)**
1. **spaCy Pipeline**: Grammar analysis, entity recognition, sentiment
2. **Domain-Specific Models**: Train on interview-specific vocabulary
3. **Content Scoring**: Sophistication, relevance, structure analysis

### **Phase 4: Intelligent Coaching (Week 4-5)**
1. **Composite Scoring**: Fluency, clarity, confidence, impact algorithms
2. **Feedback Engine**: Contextual, actionable coaching recommendations
3. **Historical Trends**: Improvement tracking across sessions

### **Phase 5: Advanced Features (Week 5-6)**
1. **Comparative Analysis**: Benchmark against successful interview patterns
2. **Personalized Coaching**: AI-driven improvement recommendations
3. **Real-time Coaching**: Live feedback during sessions

---

## Technical Requirements

### **New Dependencies**
```bash
# Python (Agent)
pip install gentle-aligner praat-parselmouth spacy
python -m spacy download en_core_web_lg

# Docker Services
docker-compose up gentle-server praat-server

# Database Migration
npx prisma migrate dev --name advanced-analytics
```

### **Infrastructure Additions**
- **Audio Storage**: S3/MinIO for session audio files
- **Processing Queue**: Redis for async audio analysis
- **ML Models**: spaCy models, custom interview domain models

### **Performance Considerations**
- **Async Processing**: Audio analysis runs post-session to avoid latency
- **Caching Strategy**: Cache alignment results, prosodic features
- **Resource Management**: GPU acceleration for large audio files

---

## Expected Outcomes

### **Enhanced User Experience**
```json
{
  "session_feedback": {
    "overall_score": 7.2,
    "scores": {
      "fluency": 6.8,
      "clarity": 8.1, 
      "confidence": 6.5,
      "impact": 7.4
    },
    "key_improvements": [
      "Vary your pitch when making key points (+0.8 confidence)",
      "Reduce 'um' usage from 12 to <5 per minute (+1.2 fluency)", 
      "Mention specific company achievements (+0.6 impact)"
    ],
    "progress": {
      "vs_last_session": "+1.3 overall improvement",
      "strongest_area": "clarity",
      "focus_area": "confidence"
    }
  }
}
```

This advanced system would position SpashtAI as a **professional-grade interview coaching platform** rather than just a conversation practice tool.

**Recommendation**: Implement this in phases, starting with audio processing foundation while maintaining current functionality.
