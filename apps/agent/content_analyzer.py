"""
Advanced Content Analysis for SpashtAI Interview Coaching
Uses spaCy for NLP analysis including grammar, entities, and sophistication scoring
"""
import logging
import re
from dataclasses import dataclass, asdict
from typing import Dict, List, Set, Tuple, Optional
from collections import Counter
import math

logger = logging.getLogger("content-analyzer")

@dataclass
class EntityMentions:
    """Extracted entities from interview content"""
    companies: List[str]
    roles: List[str]
    skills: List[str]
    locations: List[str]
    technologies: List[str]
    achievements: List[str]

@dataclass
class GrammarAnalysis:
    """Grammar and syntax analysis results"""
    sentence_count: int
    avg_sentence_length: float
    complex_sentences: int
    simple_sentences: int
    grammar_errors: List[str]
    readability_score: float  # Flesch-Kincaid grade level
    syntactic_complexity: float  # 0-10 score

@dataclass
class VocabularyAnalysis:
    """Vocabulary sophistication and diversity analysis"""
    total_words: int
    unique_words: int
    diversity_ratio: float  # unique/total
    sophistication_score: float  # 0-10 based on word frequency
    domain_relevance: float  # 0-10 interview/business relevance
    academic_words: int
    business_terms: int

@dataclass
class ContentMetrics:
    """Complete content analysis results"""
    entities: EntityMentions
    grammar: GrammarAnalysis
    vocabulary: VocabularyAnalysis
    sentiment_score: float  # -1 to 1
    confidence_language: float  # 0-10 based on word choices
    structure_score: float  # 0-10 logical flow and organization
    relevance_score: float  # 0-10 interview appropriateness

class ContentAnalyzer:
    """Advanced NLP-based content analysis for interview coaching"""
    
    def __init__(self):
        self.nlp = None
        self.available = False
        self._init_nlp()
        
        # Business/interview relevant terms
        self.business_terms = {
            'strategy', 'revenue', 'growth', 'market', 'customer', 'client',
            'project', 'team', 'leadership', 'management', 'analysis', 'development',
            'solution', 'innovation', 'efficiency', 'optimization', 'performance',
            'collaboration', 'communication', 'presentation', 'negotiation',
            'budget', 'timeline', 'stakeholder', 'deliverable', 'milestone'
        }
        
        # Academic Word List (AWL) subset for sophistication scoring
        self.academic_words = {
            'analyze', 'concept', 'constitute', 'context', 'contract', 'create',
            'data', 'define', 'derive', 'distribute', 'economy', 'environment',
            'establish', 'estimate', 'evaluate', 'evidence', 'export', 'factor',
            'finance', 'formula', 'function', 'identify', 'income', 'indicate',
            'individual', 'interpret', 'involve', 'issue', 'labor', 'legal',
            'legislate', 'major', 'method', 'occur', 'percent', 'period',
            'policy', 'principle', 'proceed', 'process', 'require', 'research',
            'response', 'role', 'section', 'significant', 'similar', 'source',
            'specific', 'structure', 'theory', 'vary'
        }
        
        # Confidence-indicating words/phrases
        self.confidence_indicators = {
            'positive': {'confident', 'certain', 'definitely', 'absolutely', 'clearly',
                        'successfully', 'achieved', 'accomplished', 'led', 'managed',
                        'created', 'developed', 'improved', 'increased', 'delivered'},
            'negative': {'maybe', 'perhaps', 'possibly', 'might', 'could', 'sort of',
                        'kind of', 'i think', 'i guess', 'probably', 'somewhat'}
        }
    
    def _init_nlp(self):
        """Initialize spaCy NLP pipeline"""
        try:
            import spacy
            from spacy.lang.en.stop_words import STOP_WORDS
            
            # Try to load large model first, fallback to medium/small
            for model_name in ['en_core_web_lg', 'en_core_web_md', 'en_core_web_sm']:
                try:
                    self.nlp = spacy.load(model_name)
                    self.stop_words = STOP_WORDS
                    self.available = True
                    logger.info(f"✅ spaCy initialized with {model_name}")
                    break
                except OSError:
                    continue
            
            if not self.available:
                logger.warning("⚠️ No spaCy model found. Install with: python -m spacy download en_core_web_lg")
                
        except ImportError:
            logger.warning("⚠️ spaCy not available. Install with: pip install spacy")
    
    def analyze_content(self, transcript: str, speaker: str = "user") -> Optional[ContentMetrics]:
        """Perform comprehensive content analysis on transcript"""
        if not self.available:
            logger.warning("spaCy not available, skipping content analysis")
            return None
        
        try:
            logger.info(f"🔬 Analyzing content for {speaker}: {len(transcript)} characters")
            
            # Process text with spaCy
            doc = self.nlp(transcript)
            
            # Extract entities
            entities = self._extract_entities(doc)
            
            # Analyze grammar and syntax
            grammar = self._analyze_grammar(doc)
            
            # Analyze vocabulary
            vocabulary = self._analyze_vocabulary(doc)
            
            # Sentiment analysis
            sentiment = self._analyze_sentiment(doc)
            
            # Confidence language analysis
            confidence_lang = self._analyze_confidence_language(doc)
            
            # Structure and organization
            structure = self._analyze_structure(doc)
            
            # Interview relevance
            relevance = self._analyze_relevance(doc, entities)
            
            return ContentMetrics(
                entities=entities,
                grammar=grammar,
                vocabulary=vocabulary,
                sentiment_score=sentiment,
                confidence_language=confidence_lang,
                structure_score=structure,
                relevance_score=relevance
            )
            
        except Exception as e:
            logger.error(f"❌ Error in content analysis: {e}")
            return None
    
    def _extract_entities(self, doc) -> EntityMentions:
        """Extract relevant entities for interview context"""
        companies = []
        roles = []
        skills = []
        locations = []
        technologies = []
        achievements = []
        
        for ent in doc.ents:
            entity_text = ent.text.strip()
            entity_label = ent.label_
            
            if entity_label == "ORG":
                companies.append(entity_text)
            elif entity_label in ["PERSON", "TITLE"]:
                # Filter for role-like entities
                if any(role_word in entity_text.lower() for role_word in 
                      ['manager', 'director', 'engineer', 'analyst', 'coordinator', 'specialist']):
                    roles.append(entity_text)
            elif entity_label in ["GPE", "LOC"]:
                locations.append(entity_text)
            elif entity_label == "PRODUCT":
                technologies.append(entity_text)
        
        # Extract skills and technologies using patterns
        tech_patterns = [
            r'\b(?:Python|Java|JavaScript|React|Node\.js|SQL|AWS|Docker|Kubernetes)\b',
            r'\b(?:machine learning|data science|project management|agile|scrum)\b',
            r'\b(?:leadership|communication|problem solving|analytical)\b'
        ]
        
        text_lower = doc.text.lower()
        for pattern in tech_patterns:
            matches = re.findall(pattern, text_lower, re.IGNORECASE)
            skills.extend(matches)
        
        # Extract achievement-like phrases
        achievement_patterns = [
            r'(?:increased|improved|reduced|achieved|delivered|led|managed|created|developed)\s+[^.]{10,50}',
            r'(?:\d+%|\$\d+|[a-z]+\s+million|\d+\s+years?)\s+[^.]{5,30}'
        ]
        
        for pattern in achievement_patterns:
            matches = re.findall(pattern, text_lower, re.IGNORECASE)
            achievements.extend(matches[:3])  # Limit to top 3
        
        return EntityMentions(
            companies=list(set(companies)),
            roles=list(set(roles)),
            skills=list(set(skills)),
            locations=list(set(locations)),
            technologies=list(set(technologies)),
            achievements=achievements
        )
    
    def _analyze_grammar(self, doc) -> GrammarAnalysis:
        """Analyze grammar, syntax, and readability"""
        sentences = list(doc.sents)
        sentence_count = len(sentences)
        
        if sentence_count == 0:
            return GrammarAnalysis(0, 0, 0, 0, [], 0, 0)
        
        # Calculate sentence lengths
        sentence_lengths = [len(sent.text.split()) for sent in sentences]
        avg_sentence_length = sum(sentence_lengths) / len(sentence_lengths)
        
        # Classify sentence complexity
        complex_sentences = 0
        simple_sentences = 0
        
        for sent in sentences:
            # Count subordinate clauses as complexity indicator
            subordinate_markers = ['because', 'although', 'while', 'since', 'whereas', 'if', 'when']
            sent_text_lower = sent.text.lower()
            
            if any(marker in sent_text_lower for marker in subordinate_markers) or len(sent.text.split()) > 20:
                complex_sentences += 1
            else:
                simple_sentences += 1
        
        # Basic grammar error detection (simplified)
        grammar_errors = self._detect_basic_errors(doc)
        
        # Readability score (simplified Flesch-Kincaid)
        readability = self._calculate_readability(doc, sentence_count, avg_sentence_length)
        
        # Syntactic complexity score
        complexity_score = min(10.0, (complex_sentences / sentence_count * 10) if sentence_count > 0 else 0)
        
        return GrammarAnalysis(
            sentence_count=sentence_count,
            avg_sentence_length=avg_sentence_length,
            complex_sentences=complex_sentences,
            simple_sentences=simple_sentences,
            grammar_errors=grammar_errors,
            readability_score=readability,
            syntactic_complexity=complexity_score
        )
    
    def _analyze_vocabulary(self, doc) -> VocabularyAnalysis:
        """Analyze vocabulary sophistication and diversity"""
        # Get all words (excluding punctuation and spaces)
        words = [token.text.lower() for token in doc if token.is_alpha and not token.is_stop]
        total_words = len(words)
        
        if total_words == 0:
            return VocabularyAnalysis(0, 0, 0, 0, 0, 0, 0)
        
        unique_words = len(set(words))
        diversity_ratio = unique_words / total_words
        
        # Count academic and business terms
        academic_count = sum(1 for word in words if word in self.academic_words)
        business_count = sum(1 for word in words if word in self.business_terms)
        
        # Sophistication score based on word frequency and academic/business terms
        sophistication = min(10.0, (academic_count + business_count) / total_words * 100)
        
        # Domain relevance based on business terms
        domain_relevance = min(10.0, business_count / total_words * 50)
        
        return VocabularyAnalysis(
            total_words=total_words,
            unique_words=unique_words,
            diversity_ratio=diversity_ratio,
            sophistication_score=sophistication,
            domain_relevance=domain_relevance,
            academic_words=academic_count,
            business_terms=business_count
        )
    
    def _analyze_sentiment(self, doc) -> float:
        """Analyze sentiment using spaCy's built-in capabilities"""
        # Simple sentiment analysis based on positive/negative word counts
        positive_words = {'good', 'great', 'excellent', 'successful', 'effective', 
                         'strong', 'confident', 'passionate', 'excited', 'proud'}
        negative_words = {'bad', 'poor', 'difficult', 'challenging', 'failed', 
                         'weak', 'concerned', 'worried', 'disappointed'}
        
        text_lower = doc.text.lower()
        positive_count = sum(1 for word in positive_words if word in text_lower)
        negative_count = sum(1 for word in negative_words if word in text_lower)
        
        total_sentiment_words = positive_count + negative_count
        if total_sentiment_words == 0:
            return 0.0
        
        return (positive_count - negative_count) / total_sentiment_words
    
    def _analyze_confidence_language(self, doc) -> float:
        """Analyze language patterns indicating confidence"""
        text_lower = doc.text.lower()
        
        # Count confidence indicators
        positive_indicators = sum(1 for phrase in self.confidence_indicators['positive'] 
                                if phrase in text_lower)
        negative_indicators = sum(1 for phrase in self.confidence_indicators['negative'] 
                                if phrase in text_lower)
        
        # Score based on ratio of confident vs uncertain language
        total_indicators = positive_indicators + negative_indicators
        if total_indicators == 0:
            return 5.0  # Neutral
        
        confidence_ratio = positive_indicators / total_indicators
        return confidence_ratio * 10
    
    def _analyze_structure(self, doc) -> float:
        """Analyze logical structure and organization"""
        sentences = list(doc.sents)
        if len(sentences) < 2:
            return 5.0
        
        # Look for transition words/phrases
        transitions = ['first', 'second', 'third', 'next', 'then', 'finally', 
                      'however', 'therefore', 'in addition', 'furthermore', 
                      'for example', 'specifically', 'in conclusion']
        
        text_lower = doc.text.lower()
        transition_count = sum(1 for transition in transitions if transition in text_lower)
        
        # Score based on presence of transitions and sentence variety
        structure_score = min(10.0, (transition_count / len(sentences) * 20) + 3)
        
        return structure_score
    
    def _analyze_relevance(self, doc, entities: EntityMentions) -> float:
        """Analyze relevance to interview context"""
        # Base score on business terms, entities, and interview-relevant content
        relevance_score = 0.0
        
        # Business terms contribute
        business_term_count = sum(1 for token in doc if token.text.lower() in self.business_terms)
        relevance_score += min(3.0, business_term_count / 10 * 3)
        
        # Entities contribute
        entity_count = (len(entities.companies) + len(entities.roles) + 
                       len(entities.skills) + len(entities.technologies))
        relevance_score += min(4.0, entity_count / 5 * 4)
        
        # Achievement mentions contribute
        relevance_score += min(3.0, len(entities.achievements))
        
        return min(10.0, relevance_score)
    
    def _detect_basic_errors(self, doc) -> List[str]:
        """Detect basic grammar errors (simplified)"""
        errors = []
        
        # Check for common issues
        text = doc.text
        
        # Double spaces
        if '  ' in text:
            errors.append("Multiple consecutive spaces found")
        
        # Sentence fragments (very basic check)
        sentences = list(doc.sents)
        for sent in sentences:
            if len(sent.text.split()) < 3:
                errors.append(f"Possible sentence fragment: '{sent.text.strip()}'")
        
        return errors[:5]  # Limit to 5 errors
    
    def _calculate_readability(self, doc, sentence_count: int, avg_sentence_length: float) -> float:
        """Calculate simplified readability score"""
        if sentence_count == 0:
            return 0.0
        
        # Count syllables (simplified - count vowel groups)
        total_syllables = 0
        for token in doc:
            if token.is_alpha:
                syllables = len(re.findall(r'[aeiouAEIOU]+', token.text))
                total_syllables += max(1, syllables)  # Minimum 1 syllable per word
        
        total_words = len([token for token in doc if token.is_alpha])
        if total_words == 0:
            return 0.0
        
        avg_syllables_per_word = total_syllables / total_words
        
        # Simplified Flesch-Kincaid Grade Level
        grade_level = 0.39 * avg_sentence_length + 11.8 * avg_syllables_per_word - 15.59
        
        return max(0.0, grade_level)

# Export main classes
__all__ = ['ContentAnalyzer', 'ContentMetrics', 'EntityMentions', 'GrammarAnalysis', 'VocabularyAnalysis']
