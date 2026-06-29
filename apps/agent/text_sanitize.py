"""Strip model chain-of-thought markup from spoken and displayed coach text."""

from __future__ import annotations

import re

_THINKING_BLOCK_RE = re.compile(r"<thinking>.*?</thinking>", re.IGNORECASE | re.DOTALL)
_UNCLOSED_THINKING_RE = re.compile(r"<thinking>.*", re.IGNORECASE | re.DOTALL)
_SPOKEN_THINKING_RE = re.compile(
    r"(?:^|\s)(?:thinking\.{0,3}|i(?:'m| am) thinking\.{0,3})(?:\s|$)",
    re.IGNORECASE,
)
_PARTIAL_TAG_SUFFIXES = (
    "<thinking>",
    "<thinkin",
    "<thinki",
    "<think",
    "<thin",
    "<thi",
    "<th",
    "<t",
    "<",
)


def strip_thinking_blocks(text: str) -> str:
    """Remove <thinking>...</thinking> and any trailing unclosed block."""
    if not text:
        return ""
    cleaned = _THINKING_BLOCK_RE.sub("", text)
    cleaned = _UNCLOSED_THINKING_RE.sub("", cleaned)
    cleaned = _SPOKEN_THINKING_RE.sub(" ", cleaned)
    return cleaned.strip()


def is_thinking_only(text: str) -> bool:
    """True when text is entirely chain-of-thought with nothing speakable."""
    return not strip_thinking_blocks(text)


class StreamingThinkingStripper:
    """Stateful filter for LLM token chunks that may split thinking tags."""

    def __init__(self) -> None:
        self._buf = ""
        self._skipping = False

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        out: list[str] = []

        while self._buf:
            lower = self._buf.lower()
            if self._skipping:
                close_at = lower.find("</thinking>")
                if close_at == -1:
                    self._buf = ""
                    break
                self._buf = self._buf[close_at + len("</thinking>") :]
                self._skipping = False
                continue

            open_at = lower.find("<thinking>")
            if open_at == -1:
                emit, self._buf = self._split_partial_suffix(self._buf)
                if emit:
                    out.append(emit)
                break

            if open_at > 0:
                out.append(self._buf[:open_at])
            self._buf = self._buf[open_at + len("<thinking>") :]
            self._skipping = True

        return "".join(out)

    @staticmethod
    def _split_partial_suffix(buf: str) -> tuple[str, str]:
        lower = buf.lower()
        for suffix in _PARTIAL_TAG_SUFFIXES:
            if lower.endswith(suffix):
                return buf[: -len(suffix)], suffix
        return buf, ""

    def flush(self) -> str:
        if self._skipping:
            self._buf = ""
            self._skipping = False
            return ""
        emit, self._buf = self._split_partial_suffix(self._buf)
        self._buf = ""
        return emit
