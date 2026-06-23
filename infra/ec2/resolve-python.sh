#!/usr/bin/env bash
# Print the best available Python 3 for the agent venv (>= 3.11).
set -euo pipefail

pick_python() {
  local c ver major minor
  for c in python3.12 python3.13 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1; then
      ver="$("$c" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
      major="${ver%%.*}"
      minor="${ver#*.}"
      if [[ "$major" -eq 3 && "$minor" -ge 11 ]]; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}

if ! pick_python; then
  echo "No Python 3.11+ found. Install: sudo apt install -y python3 python3-venv python3-pip" >&2
  exit 1
fi
