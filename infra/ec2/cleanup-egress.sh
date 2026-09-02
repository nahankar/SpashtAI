#!/usr/bin/env bash
# Purge local LiveKit egress media that has already been uploaded to S3.
#
# In production the agent targets S3 directly for recordings, so anything left
# under apps/agent/audio_storage is a local leftover. Conservative by design:
# only deletes media older than EGRESS_MAX_AGE_HOURS (default 6h), well past any
# in-flight upload. Run from cron, e.g.:
#   0 * * * * /opt/spashtai/infra/ec2/cleanup-egress.sh >> /opt/spashtai/logs/egress-cleanup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${EGRESS_LOCAL_DIR:-$ROOT/apps/agent/audio_storage}"
HOURS="${EGRESS_MAX_AGE_HOURS:-6}"

if [[ ! -d "$DIR" ]]; then
  echo "$(date -u +%FT%TZ) no egress dir: $DIR (nothing to do)"
  exit 0
fi

MINUTES=$(( HOURS * 60 ))
find "$DIR" -type f \( -name '*.mp4' -o -name '*.ogg' -o -name '*.webm' \) \
  -mmin +"$MINUTES" -print -delete
echo "$(date -u +%FT%TZ) egress cleanup done (removed media older than ${HOURS}h in $DIR)"
