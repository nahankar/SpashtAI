"""
Session log context for the LiveKit agent.

Binds the current session's identifiers (session_id, room, user_id) onto every
log record so a whole Elevate session can be filtered out of the agent logs with
one key — the same `sessionId` the API and browser logs use.

Design: purely additive and fail-safe.
  - A logging.Filter that only *adds* attributes and always returns True, so it
    can never drop or alter a log record.
  - Context lives in a ContextVar, so each per-job entrypoint task (and its
    descendants) carries its own session context without cross-talk.
  - livekit-agents' JSON/colored formatters merge non-reserved record
    attributes into their output (`_merge_record_extra`), so the bound fields
    surface automatically in both prod (JSON) and dev (colored) logs — no
    formatter changes required.

Nothing here touches the live audio path; if anything fails it degrades to a
no-op (see the guarded import in main.py).
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

_ctx: ContextVar[dict[str, Any]] = ContextVar("spashtai_log_context", default={})

# Fields we propagate onto records. Kept short and non-sensitive on purpose —
# never bind tokens, transcripts, or prompts here.
_FIELDS = ("session_id", "room", "user_id")


def bind_log_context(**fields: Any) -> None:
    """Merge fields into the current task's log context (None values ignored)."""
    current = dict(_ctx.get())
    for key, value in fields.items():
        if value is not None:
            current[key] = value
    _ctx.set(current)


def get_log_context() -> dict[str, Any]:
    return dict(_ctx.get())


class SessionContextFilter(logging.Filter):
    """Injects bound session context onto each record. Additive; never drops."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            ctx = _ctx.get()
            for key in _FIELDS:
                if key in ctx and not hasattr(record, key):
                    setattr(record, key, ctx[key])
        except Exception:
            # Logging must never raise.
            pass
        return True


_installed = False


def install_session_log_context() -> None:
    """
    Attach the context filter to the root logger and its handlers (idempotent).

    Handler-level attachment is what actually covers records from every child
    logger (callHandlers applies handler filters but not ancestor-logger
    filters), so this surfaces context regardless of which module logs.
    """
    global _installed
    if _installed:
        return
    flt = SessionContextFilter()
    root = logging.getLogger()
    if not any(isinstance(f, SessionContextFilter) for f in root.filters):
        root.addFilter(flt)
    for handler in list(root.handlers):
        if not any(isinstance(f, SessionContextFilter) for f in handler.filters):
            handler.addFilter(flt)
    _installed = True
