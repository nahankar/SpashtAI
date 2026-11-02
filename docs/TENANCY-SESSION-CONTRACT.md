# Session and recording boundary — checkpoint 2

This checkpoint isolates the existing Session data family before organization practice creation is enabled.
It does not certify the voice engine, workers, Replay, Prepare, Interviews or tenant analytics.

## Ownership contract

- Session has immutable workspace ID, workspace kind and learner ID. A composite foreign key ties its
  workspace kind to the Workspace record. Existing and legacy-created sessions remain Personal.
- Transcripts, metrics, segments, turns and recordings inherit workspace ownership through their unique
  parent session. They do not accept a second independent tenant ID. Segment references must belong to
  the same session. Parent/session identity cannot be changed to move activity between workspaces.
- With no workspace context, restricted runtime queries (including raw SQL and workers) see Personal only.
  In a workspace transaction, reads/writes require its active membership, active workspace and session owner.
  Workspace Owner/Admin roles do not automatically grant access to another learner's raw answers or audio.
- Root/session and child tables enforce PostgreSQL RLS. Migration credentials are separate. API startup
  refuses a bypass role when workspace mode is enabled or organization sessions exist.
- Legacy product associations that are not yet scoped (Prepare practice, Interview run/follow-up publication,
  Elevate Pulse and Coach action links) cannot be attached to organization sessions in this checkpoint.
- Organization practice creation and background processing remain unavailable. No client endpoint creates
  an organization session yet. Tests use explicit fixture provisioning with migration credentials.

## Read-only archive API

An additional local rollout switch, `WORKSPACE_SESSION_ARCHIVE_ENABLED=true`, permits archive reads for
organization members using workspace-only Authorization headers. It is false by default and does not
change feature readiness or enable practice creation. It is independent from the future per-product launch gates.

- `GET /api/workspaces/current/sessions?after=<id>` — own session metadata, cursor-paginated (50).
- `GET /api/workspaces/current/sessions/:sessionId` — own metadata and safe recording descriptors.
- `GET /api/workspaces/current/sessions/:sessionId/transcript` — own transcript, respecting content restrictions.
- `GET /api/workspaces/current/sessions/:sessionId/recordings/:recordingId/stream` — own local recording,
  rechecking membership and parent association. Authorization is in a header; no reusable token in a URL.

Responses omit storage paths, provider IDs and other learners' identities. Tombstones return 410;
unknown/other-owner/other-workspace identifiers return 404. Archived audio supports one byte range and
respects playback restrictions. New workspace storage keys include workspace/session/recording identity.
Remote object storage and a browser audio-player integration remain later work; no arbitrary path or URL fetch.

## Live updates

Legacy Personal WebSocket subscriptions require the identity token in the first subscribe message (not
in the URL). The server checks session ownership and tombstones at subscription and before every content
broadcast. Workspace tokens are rejected until tenant live-session dispatch is certified. The web client
and server change must ship together. Failures expose no conversation content or credentials.

## Remaining authorization review

The unscoped compatibility policy preserves existing Personal application authorization; it does not
add per-user RLS to all legacy Personal routes. A comprehensive legacy HTTP write authorization audit
is still required before any product is tenant-certified. Organization rows remain invisible to those
legacy routes under the required runtime role regardless of the supplied session identifier.

Recording paths assume only the trusted storage service can modify the configured media directory.
The current reader rejects existing symlinks; it is not a sandbox for an attacker who can concurrently
replace filesystem directories. Remote uploads/objects require a separate certified storage boundary.
