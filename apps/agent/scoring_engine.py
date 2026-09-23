"""
Advanced Scoring and Feedback Engine for SpashtAI Interview Coaching
Combines delivery, content, and linguistic metrics into actionable feedback
"""
import logging
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple
from enum import Enum
import math

from audio_processor import DeliveryMetrics
from content_analyzer import ContentMetrics
from metrics_collector import LinguisticMetrics

logger = logging.getLogger("scoring-engine")

class FeedbackPriority(Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class FeedbackCategory(Enum):
    FLUENCY = "fluency"
    CLARITY = "clarity"
    CONFIDENCE = "confidence"
    IMPACT = "impact"
    CONTENT = "content"
    DELIVERY = "delivery"

@dataclass
class FeedbackItem:
    """Single piece of actionable feedback"""
    category: FeedbackCategory
    priority: FeedbackPriority
    score_impact: float  # How much this could improve overall score
    message: str
    actionable_tip: str
    current_value: Optional[float] = None
    target_value: Optional[float] = None
    improvement_potential: Optional[float] = None

@dataclass
class CompositeScores:
    """Professional interview coaching scores"""
    fluency: float      # 0-10 (verified pace and fillers only)
    clarity: float      # 0-10 (grammar, vocabulary, structure)
    confidence: float   # 0-10 (language choices until acoustic calibration exists)
    impact: float       # 0-10 (content relevance, achievements, engagement)
    overall: float      # 0-10 weighted average

@dataclass
class PerformanceInsights:
    """Detailed performance analysis and insights"""
    scores: CompositeScores
    feedback: List[FeedbackItem]
    strengths: List[str]
    areas_for_improvement: List[str]
    progress_indicators: Dict[str, float]
    benchmark_comparison: Dict[str, str]  # vs industry standards

class ScoringEngine:
    """Advanced scoring system combining multiple analysis dimensions"""
    
    def __init__(self):
        # Scoring weights for composite scores
        self.fluency_weights = {
            # Pace joins this score only with verified word/audio timing.  Raw
            # silence intervals are delivery observations, not an objective
            # "pause appropriateness" score.
            'speech_rate': 0.6,
            'filler_rate': 0.4,
        }
        
        self.clarity_weights = {
            'grammar_score': 0.3,
            'vocabulary_sophistication': 0.3,
            'structure_score': 0.2,
            'readability': 0.2
        }
        
        self.impact_weights = {
            'content_relevance': 0.3,
            'entity_mentions': 0.2,
            'achievements': 0.2,
            'sentiment': 0.15,
            'domain_expertise': 0.15
        }
        
        # Industry benchmarks for comparison
        self.benchmarks = {
            'speech_rate': {'excellent': 140, 'good': 120, 'average': 100, 'poor': 80},
            'filler_rate': {'excellent': 2, 'good': 5, 'average': 8, 'poor': 15},
            'vocabulary_diversity': {'excellent': 0.7, 'good': 0.5, 'average': 0.3, 'poor': 0.2}
        }
        
        logger.info("🎯 ScoringEngine initialized")
    
    def calculate_comprehensive_scores(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> PerformanceInsights:
        """Calculate comprehensive performance insights"""
        
        logger.info("🔬 Calculating comprehensive interview scores")
        
        try:
            # Calculate composite scores
            scores = self._calculate_composite_scores(delivery, content, linguistic)
            
            # Generate feedback
            feedback = self._generate_feedback(delivery, content, linguistic, scores)
            
            # Identify strengths and areas for improvement
            strengths = self._identify_strengths(scores, delivery, content, linguistic)
            areas_for_improvement = self._identify_improvement_areas(scores, delivery, content, linguistic)
            
            # Calculate progress indicators
            progress_indicators = self._calculate_progress_indicators(delivery, content, linguistic)
            
            # Benchmark comparison
            benchmark_comparison = self._compare_to_benchmarks(delivery, content, linguistic)
            
            insights = PerformanceInsights(
                scores=scores,
                feedback=feedback,
                strengths=strengths,
                areas_for_improvement=areas_for_improvement,
                progress_indicators=progress_indicators,
                benchmark_comparison=benchmark_comparison
            )
            
            logger.info(f"✅ Comprehensive analysis complete. Overall score: {scores.overall:.1f}/10")
            return insights
            
        except Exception as e:
            logger.error(f"❌ Error in comprehensive scoring: {e}")
            return self._fallback_insights()
    
    def _calculate_composite_scores(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> CompositeScores:
        """Calculate the four main composite scores"""
        
        # Fluency Score (0-10)
        fluency = self._calculate_fluency_score(delivery, linguistic)
        
        # Clarity Score (0-10)
        clarity = self._calculate_clarity_score(content, linguistic)
        
        # Confidence Score (0-10)
        confidence = self._calculate_confidence_score(delivery, content)
        
        # Impact Score (0-10)
        impact = self._calculate_impact_score(content, linguistic)
        
        # Overall Score (weighted average)
        overall = (fluency * 0.25 + clarity * 0.25 + confidence * 0.25 + impact * 0.25)
        
        return CompositeScores(
            fluency=fluency,
            clarity=clarity,
            confidence=confidence,
            impact=impact,
            overall=overall
        )
    
    def _calculate_fluency_score(
        self,
        delivery: Optional[DeliveryMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> float:
        """Score only measurable fluency evidence and renormalize its weights."""
        weighted_components = []
        
        # Speech rate component
        if self._has_scoreable_timing(delivery):
            speech_rate_score = self._score_speech_rate(delivery.speech_rate)
            weighted_components.append((speech_rate_score, self.fluency_weights['speech_rate']))
        
        # Filler rate component
        if delivery and delivery.filler_word_rate >= 0:
            filler_score = self._score_filler_rate(delivery.filler_word_rate)
            weighted_components.append((filler_score, self.fluency_weights['filler_rate']))
        elif linguistic and linguistic.filler_word_rate >= 0:
            filler_score = self._score_filler_rate(linguistic.filler_word_rate)
            weighted_components.append((filler_score, self.fluency_weights['filler_rate']))

        if not weighted_components:
            return 5.0
        total_weight = sum(weight for _, weight in weighted_components)
        score = sum(value * weight for value, weight in weighted_components) / total_weight
        return min(10.0, max(0.0, score))
    
    def _calculate_clarity_score(
        self,
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> float:
        """Calculate clarity score based on language use"""
        score = 0.0
        
        if content:
            # Grammar score
            grammar_score = min(10.0, content.grammar.syntactic_complexity + 
                              (10.0 - len(content.grammar.grammar_errors)))
            score += grammar_score * self.clarity_weights['grammar_score']
            
            # Vocabulary sophistication
            vocab_score = content.vocabulary.sophistication_score
            score += vocab_score * self.clarity_weights['vocabulary_sophistication']
            
            # Structure score
            structure_score = content.structure_score
            score += structure_score * self.clarity_weights['structure_score']
            
            # Readability (inverse - lower grade level = higher score for interviews)
            readability_score = max(0.0, 10.0 - content.grammar.readability_score / 2)
            score += readability_score * self.clarity_weights['readability']
            
        elif linguistic:
            # Fallback to basic linguistic metrics
            vocab_score = linguistic.vocabulary_diversity * 10
            score += vocab_score * (self.clarity_weights['vocabulary_sophistication'] + 
                                  self.clarity_weights['grammar_score'])
            score += 5.0 * (self.clarity_weights['structure_score'] + 
                           self.clarity_weights['readability'])
        else:
            score = 5.0  # Neutral
        
        return min(10.0, max(0.0, score))
    
    def _calculate_confidence_score(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics]
    ) -> float:
        """Confidence is language-based until acoustic coaching is calibrated."""
        if not content:
            return 5.0
        return min(10.0, max(0.0, content.confidence_language))
    
    def _calculate_impact_score(
        self,
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> float:
        """Calculate impact score based on content relevance and engagement"""
        score = 0.0
        
        if content:
            # Content relevance
            relevance_score = content.relevance_score
            score += relevance_score * self.impact_weights['content_relevance']
            
            # Entity mentions (companies, roles, skills)
            entity_count = (len(content.entities.companies) + len(content.entities.roles) + 
                           len(content.entities.skills) + len(content.entities.technologies))
            entity_score = min(10.0, entity_count * 2)
            score += entity_score * self.impact_weights['entity_mentions']
            
            # Achievement mentions
            achievement_score = min(10.0, len(content.entities.achievements) * 3)
            score += achievement_score * self.impact_weights['achievements']
            
            # Sentiment (positive is better for interviews)
            sentiment_score = (content.sentiment_score + 1) * 5  # Convert -1,1 to 0,10
            score += sentiment_score * self.impact_weights['sentiment']
            
            # Domain expertise (business terms)
            domain_score = content.vocabulary.domain_relevance
            score += domain_score * self.impact_weights['domain_expertise']
            
        else:
            score = 5.0  # Neutral fallback
        
        return min(10.0, max(0.0, score))
    
    def _generate_feedback(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics],
        scores: CompositeScores
    ) -> List[FeedbackItem]:
        """Generate prioritized, actionable feedback"""
        feedback = []
        
        # Fluency feedback
        if scores.fluency < 7.0:
            feedback.extend(self._generate_fluency_feedback(delivery, linguistic, scores.fluency))
        
        # Clarity feedback
        if scores.clarity < 7.0:
            feedback.extend(self._generate_clarity_feedback(content, linguistic, scores.clarity))
        
        # Confidence feedback
        if scores.confidence < 7.0:
            feedback.extend(self._generate_confidence_feedback(delivery, content, scores.confidence))
        
        # Impact feedback
        if scores.impact < 7.0:
            feedback.extend(self._generate_impact_feedback(content, scores.impact))
        
        # Sort by priority and score impact
        feedback.sort(key=lambda x: (x.priority.value, -x.score_impact))
        
        # Limit to top 8 feedback items
        return feedback[:8]
    
    def _generate_fluency_feedback(
        self,
        delivery: Optional[DeliveryMetrics],
        linguistic: Optional[LinguisticMetrics],
        fluency_score: float
    ) -> List[FeedbackItem]:
        """Generate fluency-specific feedback"""
        feedback = []
        
        # Speech rate feedback
        speech_rate = delivery.speech_rate if self._has_scoreable_timing(delivery) else 0
        if speech_rate > 0:
            if speech_rate < 100:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.FLUENCY,
                    priority=FeedbackPriority.HIGH,
                    score_impact=1.5,
                    message=f"Your speaking pace ({speech_rate:.0f} WPM) is quite slow for interviews",
                    actionable_tip="Practice speaking at 140-160 words per minute. Read articles aloud to build natural pace",
                    current_value=speech_rate,
                    target_value=140.0
                ))
            elif speech_rate > 180:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.FLUENCY,
                    priority=FeedbackPriority.MEDIUM,
                    score_impact=1.0,
                    message=f"Your speaking pace ({speech_rate:.0f} WPM) is quite fast",
                    actionable_tip="Slow down slightly and add strategic pauses for emphasis",
                    current_value=speech_rate,
                    target_value=160.0
                ))
        
        # Filler word feedback
        filler_rate = delivery.filler_word_rate if delivery else (linguistic.filler_word_rate if linguistic else 0)
        if filler_rate > 5:
            priority = FeedbackPriority.HIGH if filler_rate > 10 else FeedbackPriority.MEDIUM
            feedback.append(FeedbackItem(
                category=FeedbackCategory.FLUENCY,
                priority=priority,
                score_impact=1.2,
                message=f"You used filler words at {filler_rate:.1f}% rate",
                actionable_tip="Pause silently instead of saying 'um', 'like', or 'you know'. Practice with a timer",
                current_value=filler_rate,
                target_value=3.0
            ))
        
        return feedback
    
    def _generate_clarity_feedback(
        self,
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics],
        clarity_score: float
    ) -> List[FeedbackItem]:
        """Generate clarity-specific feedback"""
        feedback = []
        
        if content:
            # Vocabulary feedback
            if content.vocabulary.sophistication_score < 5:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.CLARITY,
                    priority=FeedbackPriority.MEDIUM,
                    score_impact=1.0,
                    message="Use more professional vocabulary to demonstrate expertise",
                    actionable_tip="Include industry-specific terms and avoid overly casual language",
                    current_value=content.vocabulary.sophistication_score,
                    target_value=7.0
                ))
            
            # Grammar feedback
            if len(content.grammar.grammar_errors) > 2:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.CLARITY,
                    priority=FeedbackPriority.HIGH,
                    score_impact=1.3,
                    message=f"Grammar issues detected: {', '.join(content.grammar.grammar_errors[:2])}",
                    actionable_tip="Review your responses for complete sentences and proper grammar",
                    current_value=float(len(content.grammar.grammar_errors)),
                    target_value=1.0
                ))
            
            # Sentence length feedback
            if content.grammar.avg_sentence_length > 25:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.CLARITY,
                    priority=FeedbackPriority.MEDIUM,
                    score_impact=0.8,
                    message=f"Average sentence length ({content.grammar.avg_sentence_length:.1f} words) is quite long",
                    actionable_tip="Break long sentences into shorter, clearer statements",
                    current_value=content.grammar.avg_sentence_length,
                    target_value=15.0
                ))
        
        return feedback
    
    def _generate_confidence_feedback(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        confidence_score: float
    ) -> List[FeedbackItem]:
        """Generate confidence-specific feedback"""
        feedback = []
        
        # Confidence language feedback
        if content and content.confidence_language < 6:
            feedback.append(FeedbackItem(
                category=FeedbackCategory.CONFIDENCE,
                priority=FeedbackPriority.MEDIUM,
                score_impact=1.1,
                message="Use more confident language patterns",
                actionable_tip="Replace uncertain phrases ('I think', 'maybe') with definitive statements",
                current_value=content.confidence_language,
                target_value=8.0
            ))
        
        return feedback
    
    def _generate_impact_feedback(
        self,
        content: Optional[ContentMetrics],
        impact_score: float
    ) -> List[FeedbackItem]:
        """Generate impact-specific feedback"""
        feedback = []
        
        if content:
            # Company/role mentions
            if len(content.entities.companies) == 0:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.IMPACT,
                    priority=FeedbackPriority.MEDIUM,
                    score_impact=1.0,
                    message="No companies or organizations mentioned",
                    actionable_tip="Reference the company you're interviewing with and relevant industry players",
                    current_value=0.0,
                    target_value=2.0
                ))
            
            # Achievement mentions
            if len(content.entities.achievements) == 0:
                feedback.append(FeedbackItem(
                    category=FeedbackCategory.IMPACT,
                    priority=FeedbackPriority.HIGH,
                    score_impact=1.5,
                    message="No specific achievements or results mentioned",
                    actionable_tip="Include quantifiable accomplishments (percentages, dollar amounts, timelines)",
                    current_value=0.0,
                    target_value=3.0
                ))
        
        return feedback
    
    def _identify_strengths(
        self,
        scores: CompositeScores,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> List[str]:
        """Identify top strengths to reinforce"""
        strengths = []
        
        score_areas = [
            (scores.fluency, "fluency and speaking pace"),
            (scores.clarity, "clear communication"),
            (scores.confidence, "confident language"),
            (scores.impact, "impactful content")
        ]
        
        # Add strengths for scores >= 7.5
        for score, area in score_areas:
            if score >= 7.5:
                strengths.append(f"Strong {area} (score: {score:.1f}/10)")
        
        # Add specific strengths based on metrics
        if delivery:
            if delivery.filler_word_rate <= 3:
                strengths.append("Minimal use of filler words")
            if self._has_scoreable_timing(delivery) and 140 <= delivery.speech_rate <= 170:
                strengths.append("Excellent speaking pace")
        
        if content:
            if content.vocabulary.sophistication_score >= 7:
                strengths.append("Professional vocabulary usage")
            if len(content.entities.achievements) >= 2:
                strengths.append("Good use of specific achievements")
        
        return strengths[:4]  # Limit to top 4
    
    def _identify_improvement_areas(
        self,
        scores: CompositeScores,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> List[str]:
        """Identify key areas needing improvement"""
        areas = []
        
        score_areas = [
            (scores.fluency, "speech fluency and pacing"),
            (scores.clarity, "communication clarity"),
            (scores.confidence, "confident language"),
            (scores.impact, "content impact and relevance")
        ]
        
        # Add areas for scores < 6.5
        for score, area in score_areas:
            if score < 6.5:
                areas.append(f"Improve {area} (current: {score:.1f}/10)")
        
        return areas[:3]  # Limit to top 3
    
    def _calculate_progress_indicators(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> Dict[str, float]:
        """Calculate progress tracking metrics"""
        indicators = {}
        
        if delivery:
            if self._has_scoreable_timing(delivery):
                indicators['speech_rate'] = delivery.speech_rate
            indicators['filler_rate'] = delivery.filler_word_rate
        
        if content:
            indicators['vocabulary_sophistication'] = content.vocabulary.sophistication_score
            indicators['content_relevance'] = content.relevance_score
        
        if linguistic:
            indicators['vocabulary_diversity'] = linguistic.vocabulary_diversity
        
        return indicators
    
    def _compare_to_benchmarks(
        self,
        delivery: Optional[DeliveryMetrics],
        content: Optional[ContentMetrics],
        linguistic: Optional[LinguisticMetrics]
    ) -> Dict[str, str]:
        """Compare performance to industry benchmarks"""
        comparisons = {}
        
        # Speech rate comparison
        speech_rate = delivery.speech_rate if self._has_scoreable_timing(delivery) else 0
        if speech_rate > 0:
            comparisons['speech_rate'] = self._benchmark_comparison(speech_rate, 'speech_rate')
        
        # Filler rate comparison
        filler_rate = delivery.filler_word_rate if delivery else (linguistic.filler_word_rate if linguistic else 0)
        if filler_rate >= 0:
            comparisons['filler_rate'] = self._benchmark_comparison(filler_rate, 'filler_rate', inverse=True)
        
        # Vocabulary diversity
        vocab_diversity = linguistic.vocabulary_diversity if linguistic else (
            content.vocabulary.diversity_ratio if content else 0
        )
        if vocab_diversity > 0:
            comparisons['vocabulary_diversity'] = self._benchmark_comparison(vocab_diversity, 'vocabulary_diversity')
        
        return comparisons
    
    def _benchmark_comparison(self, value: float, metric: str, inverse: bool = False) -> str:
        """Compare a value to benchmarks and return descriptive text"""
        if metric not in self.benchmarks:
            return "No benchmark available"
        
        benchmarks = self.benchmarks[metric]
        
        if inverse:
            # For metrics where lower is better (like filler_rate)
            if value <= benchmarks['excellent']:
                return "Excellent (top 10%)"
            elif value <= benchmarks['good']:
                return "Good (top 25%)"
            elif value <= benchmarks['average']:
                return "Average (middle 50%)"
            else:
                return "Below average (bottom 25%)"
        else:
            # For metrics where higher is better
            if value >= benchmarks['excellent']:
                return "Excellent (top 10%)"
            elif value >= benchmarks['good']:
                return "Good (top 25%)"
            elif value >= benchmarks['average']:
                return "Average (middle 50%)"
            else:
                return "Below average (bottom 25%)"
    
    def _score_speech_rate(self, rate: float) -> float:
        """Score speech rate on 0-10 scale"""
        if 140 <= rate <= 170:
            return 10.0
        elif 120 <= rate <= 180:
            return 8.0
        elif 100 <= rate <= 200:
            return 6.0
        elif 80 <= rate <= 220:
            return 4.0
        else:
            return 2.0
    
    def _score_filler_rate(self, rate: float) -> float:
        """Score filler word rate on 0-10 scale (lower is better)"""
        if rate <= 2:
            return 10.0
        elif rate <= 5:
            return 8.0
        elif rate <= 8:
            return 6.0
        elif rate <= 12:
            return 4.0
        else:
            return 2.0
    
    @staticmethod
    def _has_scoreable_timing(delivery: Optional[DeliveryMetrics]) -> bool:
        """Only verified word/audio timing may influence a delivery score."""
        if not delivery or delivery.speech_rate <= 0:
            return False
        evidence = delivery.delivery_evidence
        if evidence.status != "experimental":
            return False
        timing = evidence.timing
        return (
            timing.get("source") in ("validated_word_timestamps", "forced_alignment")
            and isinstance(timing.get("evidence_quality"), int)
            and timing["evidence_quality"] >= 2
        )
    
    def _fallback_insights(self) -> PerformanceInsights:
        """Fallback insights when analysis fails"""
        return PerformanceInsights(
            scores=CompositeScores(5.0, 5.0, 5.0, 5.0, 5.0),
            feedback=[],
            strengths=["Session completed successfully"],
            areas_for_improvement=["Enable advanced analytics for detailed feedback"],
            progress_indicators={},
            benchmark_comparison={}
        )

# Export main classes
__all__ = ['ScoringEngine', 'PerformanceInsights', 'CompositeScores', 'FeedbackItem']
