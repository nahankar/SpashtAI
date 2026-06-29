"""
Suppress premature coach backchannels during long user monologues (PREP, 60–90s drills).

Nova Sonic endpointing fires every ~2s of silence, which makes the coach say
"I see" or "Let's break this down" while the user is still mid-answer.
"""

from __future__ import annotations

import time

# Focus areas whose exercises include 60–90 second user monologues.
MONOLOGUE_FOCUS_AREAS = frozenset({"structure", "clarity", "pacing"})

_BACKCHANNEL_STARTERS = (
    "i see",
    "let's",
    "lets",
    "great",
    "good ",
    "okay",
    "ok ",
    "sure",
    "hmm",
    "right",
    "got it",
)


class MonologueGuard:
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled
        self._last_user_at = 0.0
        self._monologue_active = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def monologue_active(self) -> bool:
        return self._monologue_active

    def on_user_fragment(self, text: str) -> None:
        if not self._enabled:
            return
        cleaned = (text or "").strip()
        if len(cleaned) < 3:
            return
        self._last_user_at = time.time()
        self._monologue_active = True

    def should_suppress_assistant(self, text: str) -> bool:
        """True when coach speech should be cut and hidden (premature backchannel)."""
        if not self._enabled or not self._monologue_active:
            return False

        since_user = time.time() - self._last_user_at
        if since_user > 10.0:
            self._monologue_active = False
            return False

        cleaned = (text or "").strip()
        if not cleaned:
            return False

        # Substantive feedback is allowed even if recent user speech.
        if len(cleaned) > 200:
            return False

        lower = cleaned.lower()
        if len(cleaned) <= 120:
            return True
        return any(lower.startswith(prefix) for prefix in _BACKCHANNEL_STARTERS)

    def mark_answer_complete(self) -> None:
        self._monologue_active = False
