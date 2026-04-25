#!/bin/bash
# subway-cursors: beforeSubmitPrompt hook → ask the extension to resume the game.
#
# Cursor sets CURSOR_PROJECT_DIR for us. We hash it so each Cursor window
# uses its own port file (otherwise the last-launched window would steal events).

set -u

WORKSPACE_HASH=$(printf '%s' "${CURSOR_PROJECT_DIR:-no-workspace}" | shasum -a 1 | cut -c1-12)
PORT_FILE="/tmp/subway-cursors-${WORKSPACE_HASH}.port"
PORT=""
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null)

if [ -n "$PORT" ]; then
  curl -s --max-time 2 "http://127.0.0.1:${PORT}/api/resume" >/dev/null 2>&1 || true
fi

# Always allow the prompt through.
echo '{"continue": true}'
