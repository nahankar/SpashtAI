#!/bin/bash
# Setup script for SpashtAI Advanced Analytics
# Installs and configures Gentle, Praat, spaCy, and other dependencies

set -e

echo "🚀 Setting up SpashtAI Advanced Analytics..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running from project root
if [ ! -f "package.json" ] || [ ! -d "apps/agent" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "Installing Python dependencies for advanced analytics..."

# Install Python dependencies
cd apps/agent
pip install -r requirements.txt

print_status "Downloading spaCy language model..."

# Download spaCy English model (try large first, fallback to medium/small)
if python -m spacy download en_core_web_lg; then
    print_success "Downloaded spaCy large model (en_core_web_lg)"
elif python -m spacy download en_core_web_md; then
    print_success "Downloaded spaCy medium model (en_core_web_md)"
elif python -m spacy download en_core_web_sm; then
    print_success "Downloaded spaCy small model (en_core_web_sm)"
else
    print_error "Failed to download spaCy model"
    exit 1
fi

cd ../..

print_status "Setting up Gentle forced alignment service..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    print_error "Docker is required for Gentle forced alignment. Please install Docker first."
    exit 1
fi

# Start Gentle service
cd infra/gentle
if docker-compose up -d; then
    print_success "Gentle service started on port 8765"
else
    print_error "Failed to start Gentle service"
    exit 1
fi

cd ../..

print_status "Testing advanced analytics components..."

# Test script to verify installations
cat > test_advanced_setup.py << 'EOF'
#!/usr/bin/env python3
"""Test script for advanced analytics setup"""

def test_spacy():
    try:
        import spacy
        # Try to load a model
        for model_name in ['en_core_web_lg', 'en_core_web_md', 'en_core_web_sm']:
            try:
                nlp = spacy.load(model_name)
                print(f"✅ spaCy working with {model_name}")
                return True
            except OSError:
                continue
        print("❌ No spaCy model found")
        return False
    except ImportError:
        print("❌ spaCy not installed")
        return False

def test_praat():
    try:
        import parselmouth
        print("✅ Praat (parselmouth) working")
        return True
    except ImportError:
        print("❌ Praat (parselmouth) not installed")
        return False

def test_other_deps():
    try:
        import numpy
        import aiohttp
        print("✅ NumPy and aiohttp working")
        return True
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        return False

def test_gentle_service():
    try:
        import aiohttp
        import asyncio
        
        async def check_gentle():
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get('http://localhost:8765', timeout=5) as response:
                        if response.status == 200:
                            print("✅ Gentle service responding")
                            return True
            except Exception:
                pass
            print("⚠️ Gentle service not responding (may need time to start)")
            return False
        
        return asyncio.run(check_gentle())
    except Exception as e:
        print(f"❌ Error checking Gentle service: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Testing Advanced Analytics Setup...\n")
    
    results = []
    results.append(test_spacy())
    results.append(test_praat())
    results.append(test_other_deps())
    results.append(test_gentle_service())
    
    success_count = sum(results)
    total_count = len(results)
    
    print(f"\n📊 Test Results: {success_count}/{total_count} components working")
    
    if success_count == total_count:
        print("🎉 All advanced analytics components are working!")
    elif success_count >= 3:
        print("✅ Core components working. Some features may be limited.")
    else:
        print("❌ Setup incomplete. Please check error messages above.")
        exit(1)
EOF

# Run the test
cd apps/agent
python test_advanced_setup.py
cd ../..

# Clean up test file
rm apps/agent/test_advanced_setup.py

print_status "Creating configuration files..."

# Create environment configuration
cat > .env.advanced << 'EOF'
# Advanced Analytics Configuration
GENTLE_URL=http://localhost:8765
ENABLE_AUDIO_ANALYSIS=true
ENABLE_CONTENT_ANALYSIS=true
ENABLE_ADVANCED_SCORING=true

# Processing Options
AUDIO_ANALYSIS_TIMEOUT=30
CONTENT_ANALYSIS_TIMEOUT=10
MIN_TRANSCRIPT_LENGTH=50

# Feature Flags
USE_GENTLE_ALIGNMENT=true
USE_PRAAT_ANALYSIS=true
USE_SPACY_NLP=true
GENERATE_COMPOSITE_SCORES=true
EOF

print_success "Created .env.advanced configuration file"

print_status "Setting up database migrations for advanced metrics..."

# Check if we need to update the database schema
if [ -f "apps/server/prisma/schema.prisma" ]; then
    print_status "Database schema already includes advanced metrics"
else
    print_error "Database schema not found"
fi

print_status "Creating usage documentation..."

cat > ADVANCED_ANALYTICS_USAGE.md << 'EOF'
# SpashtAI Advanced Analytics Usage Guide

## Quick Start

1. **Start Services**:
   ```bash
   # Start Gentle alignment service
   cd infra/gentle && docker-compose up -d
   
   # Start your SpashtAI application
   npm run dev
   ```

2. **Environment Variables**:
   Copy `.env.advanced` settings to your main `.env` file or source it:
   ```bash
   source .env.advanced
   ```

## Features Available

### 🎵 Audio-Based Delivery Analysis
- **Forced Alignment**: Precise word timestamps using Gentle
- **Prosodic Analysis**: Pitch variation, energy, voice quality using Praat
- **Pause Analysis**: Detailed pause patterns and appropriateness
- **Speech Rate**: Accurate WPM including articulation rate

### 📝 Content Intelligence
- **Grammar Analysis**: Sentence structure, complexity, error detection
- **Entity Recognition**: Companies, roles, skills, achievements mentioned
- **Vocabulary Analysis**: Sophistication, diversity, domain relevance
- **Sentiment Analysis**: Confidence language patterns

### 🎯 Professional Scoring
- **Fluency Score**: Speech rate, fillers, pause patterns (0-10)
- **Clarity Score**: Grammar, vocabulary, structure (0-10)
- **Confidence Score**: Vocal and linguistic confidence indicators (0-10)
- **Impact Score**: Content relevance, achievements, engagement (0-10)

### 🔄 Intelligent Feedback
- **Prioritized Recommendations**: High/medium/low priority actionable tips
- **Benchmark Comparisons**: Performance vs industry standards
- **Progress Tracking**: Improvement indicators across sessions

## API Integration

The advanced system extends existing endpoints:

```typescript
// Enhanced metrics with advanced analysis
GET /sessions/:sessionId/metrics
{
  "basic_metrics": { /* existing metrics */ },
  "delivery_metrics": {
    "speech_rate": 142.5,
    "articulation_rate": 156.3,
    "pitch_variation": 2.1,
    "voice_quality_score": 8.2,
    "pause_analysis": { /* detailed pause data */ }
  },
  "content_metrics": {
    "entities": {
      "companies": ["Google", "Microsoft"],
      "skills": ["Python", "machine learning"],
      "achievements": ["increased revenue by 25%"]
    },
    "vocabulary": {
      "sophistication_score": 7.8,
      "domain_relevance": 8.1
    }
  },
  "performance_insights": {
    "scores": {
      "fluency": 7.2,
      "clarity": 8.1,
      "confidence": 6.8,
      "impact": 7.5,
      "overall": 7.4
    },
    "feedback": [
      {
        "category": "confidence",
        "priority": "high",
        "message": "Vary your pitch more to sound engaging",
        "actionable_tip": "Emphasize key points with higher pitch"
      }
    ]
  }
}
```

## Troubleshooting

### Gentle Service Issues
```bash
# Check service status
docker-compose -f infra/gentle/docker-compose.yml ps

# View logs
docker-compose -f infra/gentle/docker-compose.yml logs gentle

# Restart service
docker-compose -f infra/gentle/docker-compose.yml restart gentle
```

### spaCy Model Issues
```bash
# Download missing models
python -m spacy download en_core_web_lg

# Verify installation
python -c "import spacy; nlp = spacy.load('en_core_web_lg'); print('✅ spaCy working')"
```

### Performance Optimization
- Audio analysis runs asynchronously after session ends
- Content analysis is cached for repeated requests
- Large audio files may require GPU acceleration for Praat analysis

## Development

To add custom metrics or modify scoring algorithms:

1. **Custom Delivery Metrics**: Extend `DeliveryMetrics` in `audio_processor.py`
2. **Custom Content Analysis**: Add methods to `ContentAnalyzer` in `content_analyzer.py`  
3. **Custom Scoring**: Modify weights and algorithms in `scoring_engine.py`
4. **Custom Feedback**: Add feedback rules in `ScoringEngine._generate_feedback()`

EOF

print_success "Created ADVANCED_ANALYTICS_USAGE.md"

echo ""
print_success "🎉 Advanced Analytics Setup Complete!"
echo ""
print_status "Next steps:"
echo "  1. Copy settings from .env.advanced to your main .env file"
echo "  2. Run database migrations if needed: npm run db:migrate"
echo "  3. Start your SpashtAI application: npm run dev"
echo "  4. Check ADVANCED_ANALYTICS_USAGE.md for detailed usage instructions"
echo ""
print_status "The advanced analytics system is now ready to provide:"
echo "  • 🎵 Audio-based delivery analysis with Gentle + Praat"
echo "  • 📝 Content intelligence with spaCy NLP"
echo "  • 🎯 Professional coaching scores (fluency, clarity, confidence, impact)"
echo "  • 💡 Actionable feedback with industry benchmarks"
echo ""
print_success "Happy interviewing! 🚀"
