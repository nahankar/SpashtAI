"""Server callback headers for the current voice job.

Organization rooms carry a server-signed ``workspaceScope`` in room or dispatch
metadata. Every callback for that job must echo it so the server applies the
organization's row isolation; Personal rooms have none and send only the
internal agent token. Each LiveKit job runs in its own process, so one value
per process is the job's value.
"""
import os
from typing import Optional

WORKSPACE_SCOPE_HEADER = "x-spasht-workspace-scope"
_workspace_scope: str = ""


def internal_agent_token() -> str:
    return os.getenv("INTERNAL_AGENT_TOKEN", "dev-internal-agent-token")


def set_workspace_scope(*metadata: Optional[dict]) -> None:
    """Adopt the first signed scope found in room/dispatch metadata (or clear it)."""
    global _workspace_scope
    _workspace_scope = ""
    for meta in metadata:
        value = (meta or {}).get("workspaceScope") if isinstance(meta, dict) else None
        if isinstance(value, str) and value.strip():
            _workspace_scope = value.strip()
            return


def workspace_scope() -> str:
    return _workspace_scope


def agent_headers() -> dict:
    headers = {"x-internal-agent-token": internal_agent_token()}
    if _workspace_scope:
        headers[WORKSPACE_SCOPE_HEADER] = _workspace_scope
    return headers
