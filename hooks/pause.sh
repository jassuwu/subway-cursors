#!/bin/bash
# subway-cursors: afterAgentResponse hook → ask the extension to pause the game.
# Fire-and-forget; afterAgentResponse is observational so its return value is ignored.

set -u

WORKSPACE_HASH=$(printf '%s' "${CURSOR_PROJECT_DIR:-no-workspace}" | shasum -a 1 | cut -c1-12)
PORT_FILE="/tmp/subway-cursors-${WORKSPACE_HASH}.port"
PORT=""
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null)

if [ -n "$PORT" ]; then
  curl -s --max-time 2 "http://127.0.0.1:${PORT}/api/pause" >/dev/null 2>&1 || true
fi
