"""
SpashtAI Text Signal Extraction

Extracts the 10 text-based core communication signals from conversation
transcripts using spaCy and textstat. These raw signals feed the
skill scoring layer on the Node.js server.

Signals extracted:
  1. Speech rate (WPM, variability across turns)
  2. Filler word density (count, rate, by type)
  3. Hedging language (count, rate, phrases)
  4. Sentence complexity (avg length, subordinate ratio, readability)
  5. Vocabulary diversity (ratio, sophistication)
  6. Topic coherence (avg similarity, drift count)
  7. Question handling (questions received, response time, relevance)
  8. Talk/listen balance (user ratio)
  9. Interaction signals (questions asked, participant refs, follow-ups)
 10. Idea structure (discourse markers count and types)
"""

import re
import logging
from typing import Any

import spacy
import textstat

logger = logging.getLogger("spashtai-analytics")

# Load spaCy model once at module level
_nlp = None

FILLER_PATTERNS = [
    r"\bum\b", r"\buh\b", r"\bumm\b", r"\buhh\b",
    r"\blike\b", r"\byou know\b", r"\bbasically\b",
    r"\bactually\b", r"\bliterally\b",
    r"\bi mean\b", r"\bkind of\b", r"\bsort of\b",
]

ACKNOWLEDGMENT_PATTERNS = [
    r"\bok\b", r"\bokay\b", r"\bhmm\b", r"\bhmmm\b",
    r"\bright\b", r"\byeah\b", r"\byep\b", r"\byup\b",
    r"\bso\b", r"\bwell\b", r"\bgot it\b", r"\bi see\b",
    r"\bsure\b", r"\bmhm\b",
]

HEDGING_PHRASES = [
    r"\bi think\b", r"\bmaybe\b", r"\bprobably\b",
    r"\bperhaps\b", r"\bkind of\b", r"\bsort of\b",
    r"\bi guess\b", r"\bi suppose\b", r"\bit seems\b",
    r"\bi feel like\b", r"\bnot sure\b", r"\bmight\b",
    r"\bcould be\b", r"\bpossibly\b", r"\ba little\b",
    r"\bsomewhat\b", r"\bi believe\b",
]

DISCOURSE_MARKERS = {
    "sequential": [
        r"\bfirst\b", r"\bsecond\b", r"\bthird\b",
        r"\bnext\b", r"\bthen\b", r"\bfinally\b",
        r"\bfirstly\b", r"\bsecondly\b", r"\blastly\b",
        r"\bto begin\b", r"\bafter that\b",
    ],
    "transitional": [
        r"\bhowever\b", r"\bon the other hand\b",
        r"\bin contrast\b", r"\balternatively\b",
        r"\bnevertheless\b", r"\bthat said\b",
        r"\bbut\b", r"\balthough\b", r"\byet\b",
    ],
    "causal": [
        r"\bbecause\b", r"\btherefore\b", r"\bas a result\b",
        r"\bconsequently\b", r"\bso that\b", r"\bdue to\b",
        r"\bthis means\b",
    ],
    "summary": [
        r"\bin summary\b", r"\bto summarize\b", r"\bin conclusion\b",
        r"\boverall\b", r"\bthe main point\b", r"\bthe key takeaway\b",
        r"\bto wrap up\b", r"\bin short\b",
    ],
    "emphasis": [
        r"\bimportantly\b", r"\bnotably\b", r"\bspecifically\b",
        r"\bin particular\b", r"\bespecially\b", r"\bthe key point\b",
        r"\bcritically\b",
    ],
}


def _get_nlp():
    global _nlp
    if _nlp is None:
        try:
            _nlp = spacy.load("en_core_web_md")
        except OSError:
            logger.warning("en_core_web_md not found, falling back to en_core_web_sm")
            _nlp = spacy.load("en_core_web_sm")
    return _nlp


def _count_pattern_matches(text: str, patterns: list[str]) -> dict[str, int]:
    """Count occurrences of each regex pattern in text."""
    lower = text.lower()
    counts: dict[str, int] = {}
    for pat in patterns:
        label = re.sub(r"\\b", "", pat).strip()
        counts[label] = len(re.findall(pat, lower))
    return counts


def _extract_filler_signals(user_text: str, total_words: int) -> dict:
    counts = _count_pattern_matches(user_text, FILLER_PATTERNS)
    by_type = {k: v for k, v in counts.items() if v > 0}
    total = sum(counts.values())
    rate = total / total_words if total_words > 0 else 0

    ack_counts = _count_pattern_matches(user_text, ACKNOWLEDGMENT_PATTERNS)
    ack_by_type = {k: v for k, v in ack_counts.items() if v > 0}
    ack_total = sum(ack_counts.values())
    ack_rate = ack_total / total_words if total_words > 0 else 0

    return {
        "count": total,
        "rate": round(rate, 4),
        "byType": by_type,
        "acknowledgments": {
            "count": ack_total,
            "rate": round(ack_rate, 4),
            "byType": ack_by_type,
        },
    }


def _extract_hedging_signals(user_text: str, total_words: int) -> dict:
    counts = _count_pattern_matches(user_text, HEDGING_PHRASES)
    found = [k for k, v in counts.items() if v > 0]
    total = sum(counts.values())
    rate = total / total_words if total_words > 0 else 0
    return {"count": total, "rate": round(rate, 4), "phrases": found}


def _extract_sentence_complexity(user_text: str) -> dict:
    nlp = _get_nlp()
    doc = nlp(user_text)
    sentences = list(doc.sents)
    if not sentences:
        return {
            "avgLength": 0,
            "subordinateRatio": 0,
            "readability": 50,
            "fleschKincaid": 0,
            "gunningFog": 0,
        }

    lengths = [len([t for t in s if not t.is_punct]) for s in sentences]
    avg_len = sum(lengths) / len(lengths) if lengths else 0

    subordinate_count = 0
    for sent in sentences:
        for token in sent:
            if token.dep_ in ("advcl", "relcl", "ccomp", "xcomp", "acl"):
                subordinate_count += 1
                break
    sub_ratio = subordinate_count / len(sentences) if sentences else 0

    flesch = textstat.flesch_reading_ease(user_text)
    fk_grade = textstat.flesch_kincaid_grade(user_text)
    fog = textstat.gunning_fog(user_text)

    return {
        "avgLength": round(avg_len, 1),
        "subordinateRatio": round(sub_ratio, 3),
        "readability": round(flesch, 1),
        "fleschKincaid": round(fk_grade, 1),
        "gunningFog": round(fog, 1),
    }


def _extract_vocab_diversity(user_text: str) -> dict:
    nlp = _get_nlp()
    doc = nlp(user_text)

    tokens = [t.text.lower() for t in doc if t.is_alpha and len(t.text) > 2]
    total = len(tokens)
    unique = len(set(tokens))
    ratio = unique / total if total > 0 else 0

    academic_pos = {"ADJ", "ADV"}
    domain_tags = {"ORG", "PRODUCT", "WORK_OF_ART", "LAW", "EVENT"}
    sophisticated = sum(
        1 for t in doc
        if t.is_alpha and (t.pos_ in academic_pos and len(t.text) > 6)
    )
    domain_ents = sum(1 for e in doc.ents if e.label_ in domain_tags)
    sophistication = min(10, (sophisticated + domain_ents * 2) / max(total, 1) * 100)

    return {
        "ratio": round(ratio, 3),
        "uniqueWords": unique,
        "totalWords": total,
        "sophistication": round(sophistication, 1),
    }


def _extract_topic_coherence(user_messages: list[str]) -> dict:
    if len(user_messages) < 2:
        return {"avgSimilarity": 1.0, "driftCount": 0}

    nlp = _get_nlp()
    if not nlp.meta.get("vectors", {}).get("width", 0):
        return {"avgSimilarity": 0.75, "driftCount": 0}

    docs = [nlp(m) for m in user_messages if m.strip()]
    if len(docs) < 2:
        return {"avgSimilarity": 1.0, "driftCount": 0}

    similarities = []
    drift_count = 0
    drift_threshold = 0.5
    for i in range(1, len(docs)):
        if docs[i].vector_norm == 0 or docs[i - 1].vector_norm == 0:
            continue
        sim = docs[i].similarity(docs[i - 1])
        similarities.append(sim)
        if sim < drift_threshold:
            drift_count += 1

    avg_sim = sum(similarities) / len(similarities) if similarities else 0.75
    return {"avgSimilarity": round(avg_sim, 3), "driftCount": drift_count}


def _extract_question_handling(messages: list[dict], duration_sec: float) -> dict:
    questions_received = 0
    response_times: list[float] = []
    relevance_scores: list[float] = []

    nlp = _get_nlp()

    for i, msg in enumerate(messages):
        if msg["role"] != "assistant":
            continue
        text = msg["content"]
        if "?" in text:
            questions_received += 1
            if i + 1 < len(messages) and messages[i + 1]["role"] == "user":
                ts_current = msg.get("timestamp")
                ts_next = messages[i + 1].get("timestamp")
                if ts_current and ts_next:
                    try:
                        delta = float(ts_next) - float(ts_current)
                        if 0 < delta < 300:
                            response_times.append(delta)
                    except (ValueError, TypeError):
                        pass

                q_doc = nlp(text)
                a_doc = nlp(messages[i + 1]["content"])
                if q_doc.vector_norm and a_doc.vector_norm:
                    relevance_scores.append(round(q_doc.similarity(a_doc), 2))

    avg_resp = round(sum(response_times) / len(response_times), 2) if response_times else 0
    return {
        "questionsReceived": questions_received,
        "avgResponseTime": avg_resp,
        "relevanceScores": relevance_scores,
    }


def _extract_talk_listen_balance(messages: list[dict]) -> dict:
    user_words = 0
    total_words = 0
    for msg in messages:
        wc = len(msg["content"].split())
        total_words += wc
        if msg["role"] == "user":
            user_words += wc
    ratio = user_words / total_words if total_words > 0 else 0.5
    return {"userRatio": round(ratio, 3)}


def _extract_interaction_signals(user_text: str, all_messages: list[dict]) -> dict:
    questions_asked = sum(1 for m in all_messages if m["role"] == "user" and "?" in m["content"])

    nlp = _get_nlp()
    doc = nlp(user_text)
    person_refs = sum(1 for e in doc.ents if e.label_ == "PERSON")

    follow_up_patterns = [
        r"\bbuilding on\b", r"\bto add to\b", r"\bgoing back to\b",
        r"\bas you mentioned\b", r"\byou said\b", r"\byou mentioned\b",
        r"\bthat's a good point\b", r"\bi agree\b",
    ]
    follow_ups = 0
    lower = user_text.lower()
    for pat in follow_up_patterns:
        follow_ups += len(re.findall(pat, lower))

    return {
        "questionsAsked": questions_asked,
        "participantReferences": person_refs,
        "followUps": follow_ups,
    }


def _extract_idea_structure(user_text: str) -> dict:
    lower = user_text.lower()
    marker_counts: dict[str, int] = {}
    total = 0
    for category, patterns in DISCOURSE_MARKERS.items():
        count = 0
        for pat in patterns:
            count += len(re.findall(pat, lower))
        marker_counts[category] = count
        total += count
    return {
        "markerCount": total,
        "markerTypes": {k: v for k, v in marker_counts.items() if v > 0},
    }


def _extract_entities(user_text: str) -> dict:
    nlp = _get_nlp()
    doc = nlp(user_text)
    entities: dict[str, list[str]] = {
        "companies": [],
        "roles": [],
        "skills": [],
        "technologies": [],
        "people": [],
    }
    label_map = {
        "ORG": "companies",
        "PERSON": "people",
        "PRODUCT": "technologies",
        "WORK_OF_ART": "skills",
    }
    seen: set[str] = set()
    for ent in doc.ents:
        bucket = label_map.get(ent.label_)
        if bucket and ent.text not in seen:
            entities[bucket].append(ent.text)
            seen.add(ent.text)
    return entities


def extract_text_signals(
    messages: list[dict],
    duration_sec: float = 0,
) -> dict[str, Any]:
    """
    Main entry point: extract all 10 text-based communication signals.

    Args:
        messages: list of {"role": "user"|"assistant", "content": "...", "timestamp"?: ...}
        duration_sec: session duration in seconds (for WPM calculation)

    Returns:
        dict with all signal groups
    """
    user_messages = [m["content"] for m in messages if m["role"] == "user" and m.get("content")]
    user_text = " ".join(user_messages)
    user_words = len(user_text.split())

    # Estimate user speaking time (~2.5 words/sec for natural speech)
    # rather than using total session duration which includes AI/other speakers
    estimated_speaking_sec = max(user_words / 2.5, 1)
    speaking_min = estimated_speaking_sec / 60

    turn_lengths = [len(m["content"].split()) for m in messages if m["role"] == "user" and m.get("content")]
    wpm = user_words / speaking_min if speaking_min > 0 else 0
    variability = 0
    if turn_lengths and len(turn_lengths) > 1:
        mean_len = sum(turn_lengths) / len(turn_lengths)
        variance = sum((l - mean_len) ** 2 for l in turn_lengths) / len(turn_lengths)
        variability = round((variance ** 0.5) / mean_len if mean_len > 0 else 0, 3)

    signals = {
        "speechRate": {
            "wpm": round(wpm, 1),
            "variability": variability,
            "totalWords": user_words,
        },
        "fillers": _extract_filler_signals(user_text, user_words),
        "hedging": _extract_hedging_signals(user_text, user_words),
        "sentenceComplexity": _extract_sentence_complexity(user_text),
        "vocabDiversity": _extract_vocab_diversity(user_text),
        "topicCoherence": _extract_topic_coherence(user_messages),
        "questionHandling": _extract_question_handling(messages, duration_sec),
        "talkListenBalance": _extract_talk_listen_balance(messages),
        "interactionSignals": _extract_interaction_signals(user_text, messages),
        "ideaStructure": _extract_idea_structure(user_text),
        "entities": _extract_entities(user_text),
    }

    return signals
