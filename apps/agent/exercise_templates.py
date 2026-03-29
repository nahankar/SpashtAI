"""
Structured practice exercise templates for Elevate sessions.

Each focus area has a structured exercise the AI coach runs when
a user arrives from Replay (with specific improvement context).
"""

EXERCISE_TEMPLATES: dict[str, dict] = {
    "clarity": {
        "name": "Clarity Challenge",
        "warmup": (
            "I'm going to give you a technical or complex topic, and you'll explain it "
            "to me as if I'm someone with no background in it. I'll evaluate how clear "
            "and easy to follow your explanation is."
        ),
        "rounds": [
            {
                "instruction": (
                    "Explain the concept I give you in under 60 seconds. "
                    "Use simple language, avoid jargon, and structure your explanation "
                    "with a clear beginning, middle, and end."
                ),
                "coaching_focus": [
                    "Did you avoid jargon or explain it when used?",
                    "Was there a clear logical flow?",
                    "Could a non-expert follow your explanation?",
                ],
            },
            {
                "instruction": (
                    "Now explain the same concept again, but this time use an analogy "
                    "or real-world example to make it even clearer."
                ),
                "coaching_focus": [
                    "Was the analogy effective and relatable?",
                    "Did it make the concept more accessible?",
                ],
            },
        ],
        "wrap_up": (
            "Summarize what you explained in one sentence. "
            "This tests whether you can distill a complex idea into its essence."
        ),
    },
    "confidence": {
        "name": "Confidence Builder",
        "warmup": (
            "We're going to practice speaking with authority. I'll give you scenarios "
            "where you need to make a recommendation or present a position. "
            "The goal is to eliminate hedging language like 'I think', 'maybe', 'sort of' "
            "and replace them with direct, assertive statements."
        ),
        "rounds": [
            {
                "instruction": (
                    "I'll describe a situation. Present your recommendation as if "
                    "you're advising a senior leader. Be direct and decisive — "
                    "no 'I think' or 'maybe'. State your position clearly."
                ),
                "coaching_focus": [
                    "Did you use hedging phrases? I'll flag each one.",
                    "Was your recommendation stated as a clear position?",
                    "Did your tone convey certainty?",
                ],
            },
            {
                "instruction": (
                    "Now defend your recommendation when I push back. "
                    "Maintain your position confidently while acknowledging the concern."
                ),
                "coaching_focus": [
                    "Did you hold your ground without becoming defensive?",
                    "Did you acknowledge the pushback constructively?",
                ],
            },
        ],
        "wrap_up": (
            "Give me your final recommendation in two sentences. "
            "Make it sound like you fully own it."
        ),
    },
    "filler_words": {
        "name": "Filler Word Elimination",
        "warmup": (
            "We're going to practice speaking without filler words — "
            "no 'um', 'uh', 'like', 'you know', 'basically', or 'actually'. "
            "I'll give you a topic and you speak for 90 seconds. "
            "When you catch yourself using a filler, pause and restart the sentence. "
            "Silence is better than a filler."
        ),
        "rounds": [
            {
                "instruction": (
                    "Speak about the topic I give you for about 90 seconds. "
                    "Focus on replacing fillers with brief pauses. "
                    "If you notice a filler, stop, take a breath, and continue."
                ),
                "coaching_focus": [
                    "Count of filler words used",
                    "Did you self-correct when you caught a filler?",
                    "Were your pauses effective replacements?",
                ],
            },
            {
                "instruction": (
                    "Now repeat the exercise with a new topic. "
                    "This time, try to cut your filler count in half. "
                    "Slow down slightly — rushing causes fillers."
                ),
                "coaching_focus": [
                    "Improvement from round 1",
                    "Is the pacing more controlled?",
                ],
            },
        ],
        "wrap_up": (
            "Summarize what you talked about in 30 seconds, filler-free. "
            "Think of each pause as a power move, not a weakness."
        ),
    },
    "engagement": {
        "name": "Engagement Activator",
        "warmup": (
            "We're going to practice making your communication more engaging. "
            "This means asking questions, using vivid examples, varying your tone, "
            "and making the listener feel involved — not just talked at."
        ),
        "rounds": [
            {
                "instruction": (
                    "Present an idea or update to me as if I'm your team. "
                    "Include at least one question to the audience, one concrete example, "
                    "and one moment where you check for understanding."
                ),
                "coaching_focus": [
                    "Did you ask questions to involve the audience?",
                    "Were your examples vivid and relatable?",
                    "Did you check for understanding?",
                ],
            },
            {
                "instruction": (
                    "Now imagine you're presenting the same thing but your audience looks bored. "
                    "How do you re-engage them? Use a story, a surprising fact, or a direct question."
                ),
                "coaching_focus": [
                    "Did you use a hook to recapture attention?",
                    "Was your delivery more dynamic?",
                ],
            },
        ],
        "wrap_up": (
            "Close your presentation with a call-to-action that makes "
            "the audience want to do something specific."
        ),
    },
    "pacing": {
        "name": "Pacing Control",
        "warmup": (
            "We're going to work on your speaking pace. The ideal range is "
            "120 to 160 words per minute. Too slow and you lose attention. "
            "Too fast and people can't follow. We'll practice finding your "
            "sweet spot and using strategic pauses for emphasis."
        ),
        "rounds": [
            {
                "instruction": (
                    "Explain something you know well for about 60 seconds. "
                    "Focus on maintaining a steady, moderate pace. "
                    "Before each new point, take a deliberate one-second pause."
                ),
                "coaching_focus": [
                    "Was the pace comfortable to follow?",
                    "Were pauses used intentionally before key points?",
                    "Did the pace stay consistent or speed up when excited?",
                ],
            },
            {
                "instruction": (
                    "Now tell me something you're excited about — a project, an idea. "
                    "The challenge: don't speed up. Keep the same measured pace. "
                    "Use pauses to build anticipation instead of rushing."
                ),
                "coaching_focus": [
                    "Did excitement cause you to speed up?",
                    "Were pauses maintained even under excitement?",
                ],
            },
        ],
        "wrap_up": (
            "Deliver one key takeaway slowly and deliberately, "
            "as if it's the most important thing you'll say all day."
        ),
    },
    "structure": {
        "name": "Structure Sprint",
        "warmup": (
            "We're going to practice organizing your thoughts using frameworks. "
            "I'll give you a question, and you'll answer using the PREP method: "
            "Point, Reason, Example, Point. This keeps your responses focused and logical."
        ),
        "rounds": [
            {
                "instruction": (
                    "Answer my question using PREP: Start with your main point, "
                    "give one reason, provide a specific example, then restate your point. "
                    "Keep it under 90 seconds."
                ),
                "coaching_focus": [
                    "Did you state your point clearly upfront?",
                    "Was the reason logical and supporting?",
                    "Was the example specific and relevant?",
                    "Did you circle back to your main point?",
                ],
            },
            {
                "instruction": (
                    "Now I'll give you a more complex question. Use signposting: "
                    "'There are three things to consider. First... Second... Third...' "
                    "This makes multi-part answers easy to follow."
                ),
                "coaching_focus": [
                    "Did you use clear signposting?",
                    "Were the parts logically ordered?",
                    "Could I easily count how many points you made?",
                ],
            },
        ],
        "wrap_up": (
            "Give me a 30-second structured summary of everything we discussed, "
            "using signposting to organize your thoughts."
        ),
    },
    "conciseness": {
        "name": "Conciseness Drill",
        "warmup": (
            "We're going to practice saying more with fewer words. "
            "I'll ask you questions, and your goal is to give complete, "
            "useful answers in as few words as possible — without losing meaning. "
            "Think of it as verbal editing in real time."
        ),
        "rounds": [
            {
                "instruction": (
                    "Answer my question completely but in under 30 seconds. "
                    "Cut any word that doesn't add information. "
                    "No throat-clearing phrases like 'So basically what I mean is...'"
                ),
                "coaching_focus": [
                    "Were there unnecessary words or phrases?",
                    "Did you start speaking right away or warm up first?",
                    "Was the answer complete despite being brief?",
                ],
            },
            {
                "instruction": (
                    "Now take your answer and cut it in half. "
                    "Say the exact same thing in 15 seconds or less. "
                    "This forces you to find the essence of your message."
                ),
                "coaching_focus": [
                    "Did you preserve the key information?",
                    "Were filler phrases eliminated?",
                ],
            },
        ],
        "wrap_up": (
            "In one sentence, tell me the single most important thing "
            "you want someone to take away from this conversation."
        ),
    },
    "action_items": {
        "name": "Decisive Closer",
        "warmup": (
            "We're going to practice closing conversations with clear decisions "
            "and action items. Many meetings end without clear next steps. "
            "Your job is to make sure every conversation has a clear outcome."
        ),
        "rounds": [
            {
                "instruction": (
                    "I'll describe a meeting scenario. You close it by stating: "
                    "what was decided, who owns what action, and by when. "
                    "Be specific — no vague 'we'll follow up later'."
                ),
                "coaching_focus": [
                    "Were decisions stated explicitly?",
                    "Did each action have an owner and deadline?",
                    "Was anything left ambiguous?",
                ],
            },
            {
                "instruction": (
                    "Now I'll play a stakeholder who's trying to leave without committing. "
                    "Your job is to diplomatically pin down the decision and next steps "
                    "before the conversation ends."
                ),
                "coaching_focus": [
                    "Did you redirect the conversation to decisions?",
                    "Were you diplomatic but firm?",
                ],
            },
        ],
        "wrap_up": (
            "Summarize our session as if you were sending a follow-up email: "
            "decisions made, actions assigned, deadlines set."
        ),
    },
}


def _get_focus_metrics(focus_area: str, metrics: dict) -> list[str]:
    """Return formatted metric strings most relevant to the focus area."""
    result = []
    wpm = metrics.get("wordsPerMinute")
    fillers = metrics.get("fillerWordCount")
    filler_rate = metrics.get("fillerWordRate", 0)
    hedging = metrics.get("hedgingCount")
    hedging_rate = metrics.get("hedgingRate", 0)
    avg_sent = metrics.get("avgSentenceLength")
    questions = metrics.get("questionsAsked")
    speaking_pct = metrics.get("speakingPercentage")

    if focus_area == "pacing":
        if wpm: result.append(f"Speaking pace: {wpm:.0f} WPM (ideal: 120-160)")
        if speaking_pct: result.append(f"Speaking share: {speaking_pct:.0f}%")
    elif focus_area == "clarity":
        if avg_sent: result.append(f"Avg sentence length: {avg_sent:.1f} words")
        if wpm: result.append(f"Speaking pace: {wpm:.0f} WPM")
    elif focus_area in ("confidence", "filler_words"):
        if hedging: result.append(f"Hedging phrases: {hedging} ({hedging_rate:.1%} rate)")
        if fillers: result.append(f"Filler words: {fillers} ({filler_rate:.1%} rate)")
    elif focus_area == "conciseness":
        if avg_sent: result.append(f"Avg sentence length: {avg_sent:.1f} words")
        if fillers: result.append(f"Filler words: {fillers}")
    elif focus_area == "engagement":
        if questions: result.append(f"Questions asked: {questions}")
        if speaking_pct: result.append(f"Speaking share: {speaking_pct:.0f}%")
    elif focus_area == "structure":
        if avg_sent: result.append(f"Avg sentence length: {avg_sent:.1f} words")
    return result


def _get_other_metrics(focus_area: str, metrics: dict) -> list[str]:
    """Return formatted metric strings NOT directly related to the focus area."""
    result = []
    wpm = metrics.get("wordsPerMinute")
    fillers = metrics.get("fillerWordCount")
    filler_rate = metrics.get("fillerWordRate", 0)
    hedging = metrics.get("hedgingCount")
    hedging_rate = metrics.get("hedgingRate", 0)
    avg_sent = metrics.get("avgSentenceLength")
    questions = metrics.get("questionsAsked")
    speaking_pct = metrics.get("speakingPercentage")

    if focus_area != "pacing":
        if wpm: result.append(f"Speaking pace: {wpm:.0f} WPM")
    if focus_area not in ("confidence", "filler_words"):
        if fillers: result.append(f"Filler words: {fillers} ({filler_rate:.1%} rate)")
        if hedging: result.append(f"Hedging phrases: {hedging}")
    if focus_area not in ("clarity", "conciseness", "structure"):
        if avg_sent: result.append(f"Avg sentence length: {avg_sent:.1f} words")
    if focus_area != "engagement":
        if questions: result.append(f"Questions asked: {questions}")
    if focus_area != "pacing":
        if speaking_pct: result.append(f"Speaking share: {speaking_pct:.0f}%")
    return result


def get_exercise_instructions(
    focus_area: str,
    replay_context: str | None = None,
    coaching_context: dict | None = None,
) -> str:
    """Build structured exercise instructions for the AI coach."""
    template = EXERCISE_TEMPLATES.get(focus_area)
    if not template:
        return ""

    lines = [
        f"SESSION TYPE: Guided Practice — \"{template['name']}\"",
        "",
        "Use the exercise below as your coaching GUIDE, not a rigid script.",
        "Follow the general flow but adapt naturally based on the conversation.",
        "If the user wants to explore something related, go with it — then gently steer back.",
        "Your tone should feel like a real coach, not a quiz master reading from a checklist.",
        "",
    ]

    # Rich coaching context from Replay analysis + Progress Pulse
    if coaching_context:
        lines.append("IMPORTANT: You DO have access to this user's communication data from their past meetings.")
        lines.append("You MUST reference these specific numbers and examples in your coaching.")
        lines.append("When the user asks if you have their data, say YES and cite the specifics below.")
        lines.append("")

        # 1) FOCUS AREA DATA FIRST — this is what the session is about
        skill_summaries = coaching_context.get("skillSummaries", {})
        focus_data = skill_summaries.get(focus_area)
        if focus_data:
            current = focus_data.get("current", 0)
            prev = focus_data.get("previous")
            trend = ""
            if prev is not None:
                diff = current - prev
                trend_word = 'improving' if diff > 0 else ('stable' if diff == 0 else 'declining')
                trend = f" ({trend_word}, was {prev})"
            lines.append(f"PRIMARY FOCUS — {focus_area.upper()} SCORE: {current}/10{trend}")
            lines.append(f"This is the skill they came to practice. Lead with this in your greeting.")
            lines.append(f"Example greeting: 'Your {focus_area} score is {current} out of 10 — let's work on getting that up.'")
            lines.append("")

        # Focus-specific metrics (surface the most relevant ones first)
        replay = coaching_context.get("replayInsights")
        if replay:
            metrics = replay.get("metrics", {})
            focus_metrics = _get_focus_metrics(focus_area, metrics)
            if focus_metrics:
                lines.append(f"Key metrics related to {focus_area}:")
                for m in focus_metrics:
                    lines.append(f"  - {m}")
                lines.append("")

            # Replay trigger (why they're here)
            trigger = replay.get("replayTrigger")
            if trigger:
                lines.append(f"Why they started this session: \"{trigger}\"")
                lines.append("")

            # Focus-specific improvements from AI
            focus_imps = replay.get("focusImprovements", [])
            if focus_imps:
                lines.append(f"AI-identified improvement areas for {focus_area}:")
                for imp in focus_imps[:3]:
                    point = imp.get("point", "")
                    suggestion = imp.get("suggestion", "")
                    lines.append(f"  - {point}")
                    if suggestion:
                        lines.append(f"    Tip: {suggestion}")
                lines.append("")

            # Real example phrases from their meeting
            examples = replay.get("examplePhrases", [])
            if examples:
                lines.append("ACTUAL PHRASES from their meeting you can reference:")
                for i, ex in enumerate(examples[:4], 1):
                    lines.append(f'  {i}. "{ex}"')
                lines.append("Use these as coaching material — ask them to rephrase, shorten, or deliver more confidently.")
                lines.append("")

        # 2) FULL SKILL OVERVIEW (secondary — for context, not the focus)
        if skill_summaries:
            lines.append("Full skill overview (for context, NOT your primary focus):")
            for skill, data in skill_summaries.items():
                if skill == focus_area:
                    continue
                current = data.get("current", 0)
                prev = data.get("previous")
                trend = ""
                if prev is not None:
                    diff = current - prev
                    trend_word = 'improving' if diff > 0 else ('stable' if diff == 0 else 'declining')
                    trend = f" ({trend_word}, was {prev})"
                lines.append(f"  - {skill}: {current}/10{trend}")
            lines.append("")

        # 3) Supporting detail from replay
        if replay:
            metrics = replay.get("metrics", {})
            other_metrics = _get_other_metrics(focus_area, metrics)
            if other_metrics:
                lines.append("Other meeting metrics (reference only if relevant):")
                for m in other_metrics:
                    lines.append(f"  - {m}")
                lines.append("")

            strengths = replay.get("strengths", [])
            if strengths:
                lines.append("Their strengths (acknowledge briefly, then refocus on practice):")
                for s in strengths[:3]:
                    lines.append(f"  - {s.get('point', '')}")
                lines.append("")

            hedging = replay.get("hedgingPhrases")
            if hedging and isinstance(hedging, list):
                lines.append(f"Hedging phrases they overuse: {', '.join(hedging[:5])}")
                lines.append("")

            fillers_by_type = replay.get("fillersByType")
            if fillers_by_type and isinstance(fillers_by_type, dict):
                top_fillers = sorted(fillers_by_type.items(), key=lambda x: x[1], reverse=True)[:5]
                if top_fillers:
                    filler_str = ", ".join(f'"{w}" ({c}x)' for w, c in top_fillers)
                    lines.append(f"Their filler words: {filler_str}")
                    lines.append("")

        # Last practice session summary (compact coaching continuity)
        lps = coaching_context.get("lastPracticeSummary")
        session_count = coaching_context.get("elevateSessionCount", 0)
        if lps:
            date_str = ""
            raw_date = lps.get("date", "")
            if raw_date:
                try:
                    from datetime import datetime as _dt
                    d = _dt.fromisoformat(str(raw_date).replace("Z", "+00:00"))
                    date_str = d.strftime("%b %d")
                except Exception:
                    date_str = str(raw_date)[:10]

            lines.append(f"LAST PRACTICE SESSION ({focus_area}, {date_str}):")
            if lps.get("topStrength"):
                lines.append(f"  Top strength: {lps['topStrength']}")
            if lps.get("primaryImprovement"):
                lines.append(f"  Improvement area: {lps['primaryImprovement']}")

            focus_score = lps.get("focusSkillScore")
            replay_score = lps.get("replaySkillScore")
            delta = lps.get("improvementDelta")
            if focus_score is not None and replay_score is not None and delta is not None:
                direction = "improving" if delta > 0 else ("declining" if delta < 0 else "same")
                lines.append(f"  {focus_area} score in practice: {focus_score}/10 (vs {replay_score}/10 in meeting — {direction}, delta {delta:+.1f})")
            elif focus_score is not None:
                lines.append(f"  {focus_area} score in practice: {focus_score}/10")

            if lps.get("exampleQuote"):
                lines.append(f'  Example from practice: "{lps["exampleQuote"]}"')

            lines.append("  Build on this progress. Reference what they practiced. Don't repeat the same advice.")
            lines.append("")
        elif session_count > 0:
            lines.append(f"They have practiced {focus_area} {session_count} time(s) before.")
            lines.append("Acknowledge their commitment to practice.")
            lines.append("")

        lines.append("COACHING RULES:")
        lines.append(f"1. ALWAYS lead with {focus_area} — that is the reason they are here.")
        lines.append(f"2. In your greeting, mention their {focus_area} score and what you'll work on.")
        lines.append("3. Only mention other skills briefly to acknowledge strengths or connect to the focus area.")
        lines.append("4. When the user asks about their data, lead with the focus skill first, then other scores.")
        lines.append("5. Do NOT recite all data as a list — weave it naturally into coaching.")
        lines.append("")
    elif replay_context:
        lines.append(f"CONTEXT FROM REPLAY ANALYSIS: \"{replay_context}\"")
        lines.append(
            "Use this context to personalize your scenarios and examples. "
            "Reference the user's actual weakness from their meeting analysis."
        )
        lines.append("")

    lines.append("SUGGESTED EXERCISE FLOW:")
    lines.append("")
    lines.append("START — WARM-UP")
    lines.append(f"Set the stage: {template['warmup']}")
    lines.append("Keep it conversational. Ask if they're ready before jumping in.")
    lines.append("")

    for i, round_data in enumerate(template["rounds"], 1):
        lines.append(f"ROUND {i}")
        lines.append(f"Prompt: {round_data['instruction']}")
        lines.append("After they respond, give feedback on:")
        for focus in round_data["coaching_focus"]:
            lines.append(f"  - {focus}")
        lines.append(
            "Discuss the feedback conversationally — ask what they noticed, "
            "what felt different. Then transition to the next round naturally."
        )
        lines.append("")

    lines.append("WRAP-UP")
    lines.append(f"{template['wrap_up']}")
    lines.append("")
    lines.append(
        "End with a brief conversational assessment: "
        "what improved during the session, one thing to keep practicing, "
        "and genuine encouragement. Keep it natural, like a coach after a good workout."
    )

    return "\n".join(lines)
