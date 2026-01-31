#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"
. "$SCRIPT_DIR/lib.sh"

# Args via env to keep quoting simple
# REQUIRED: NAME, PROMPT, CWD, TITLE
# OPTIONAL: AGENT, MODEL, SESSION_ID, FILES_FILE

[ -n "${NAME:-}" ] || { printf '%s\n' '{"ok":false,"error":"NAME env required"}'; exit 1; }
[ -n "${PROMPT:-}" ] || { printf '%s\n' '{"ok":false,"error":"PROMPT env required"}'; exit 1; }
CWD=${CWD:-$(pwd)}
TITLE=${TITLE:-"persistent-subagent: $NAME"}
AGENT=${AGENT:-}
MODEL=${MODEL:-}
SESSION_ID=${SESSION_ID:-}
FILES_FILE=${FILES_FILE:-}

CWD=$(cd "$CWD" && pwd)

# Build opencode args
set -- run "$PROMPT" --title "$TITLE"
if [ -n "$AGENT" ]; then set -- "$@" --agent "$AGENT"; fi
if [ -n "$MODEL" ]; then set -- "$@" --model "$MODEL"; fi
if [ -n "$SESSION_ID" ]; then set -- "$@" --session "$SESSION_ID"; fi
if [ -n "$FILES_FILE" ] && [ -f "$FILES_FILE" ]; then
  while IFS= read -r f; do [ -n "$f" ] && set -- "$@" --file "$f"; done < "$FILES_FILE"
fi

# Start process
(cd "$CWD" && opencode "$@") &
PID=$!

startedAt=$(utc_now_iso)
registry_write_record "$CWD" "$NAME" "$PID" "" "running" "" "$startedAt" "$startedAt" "" "$MODEL" "$PROMPT"

# Discover sessionId by title (best-effort, up to 20s)
i=0
SESSION_DISC=""
while [ $i -lt 40 ]; do
  SESSION_DISC=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
  [ -n "$SESSION_DISC" ] && break
  i=$((i+1))
  sleep 0.5
done

# Wait for completion
wait "$PID" || true
EXIT_CODE=$?
finishedAt=$(utc_now_iso)

registry_write_record "$CWD" "$NAME" "$PID" "$SESSION_DISC" "done" "$EXIT_CODE" "$startedAt" "$finishedAt" "$finishedAt" "$MODEL" "$PROMPT"

exit 0
