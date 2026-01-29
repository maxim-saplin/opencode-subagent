#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  extract_last.sh (--name <logicalName> | --session <sessionId>) [--cwd <dir>] [--json]

Default output:
  Prints last assistant message text.

With --json:
  Prints { ok, sessionId, lastAssistantText }.
EOF
}

NAME=""
SESSION_ID=""
CWD=$(pwd)
JSON_MODE=0
TITLE_PREFIX="$TITLE_PREFIX_DEFAULT"
EXPORT_TMP=""

cleanup() {
  [ -n "${EXPORT_TMP:-}" ] && [ -f "$EXPORT_TMP" ] && rm -f "$EXPORT_TMP" || true
}

trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --session) SESSION_ID="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift 1 ;;
    --title-prefix) TITLE_PREFIX="$2"; shift 2 ;;
    *)
      usage >&2
      die "Unknown argument: $1" "Use --help to see supported flags."
      ;;
  esac
done

require_cmd opencode
require_cmd osascript

CWD=$(cd "$CWD" && pwd)
INDEX=$(index_path "$CWD")
LOGF=$(log_path "$CWD")

if [ -z "$SESSION_ID" ]; then
  [ -n "$NAME" ] || die "Either --name or --session is required"
  SESSION_ID=$(resolve_session_id_by_name "$INDEX" "$LOGF" "$NAME" || true)
  if [ -z "$SESSION_ID" ]; then
    TITLE="${TITLE_PREFIX}${NAME}"
    SESSION_ID=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
  fi
fi

[ -n "$SESSION_ID" ] || die "No session found" "Start a session first or provide --session explicitly."

EXPORT_TMP=$(mktemp -t opencode-subagent-export.XXXXXX)
(cd "$CWD" && opencode export "$SESSION_ID" > "$EXPORT_TMP" 2>/dev/null) || true
LAST_TEXT=""
if [ -s "$EXPORT_TMP" ]; then
  LAST_TEXT=$(cat "$EXPORT_TMP" | json_extract_last_assistant_text || true)
fi

if [ "$JSON_MODE" -eq 1 ]; then
  if [ -n "$LAST_TEXT" ]; then
    LAST_JSON=$(json_quote "$LAST_TEXT")
  else
    LAST_JSON=null
  fi
  printf '%s\n' "{\"ok\":true,\"sessionId\":$(json_quote "$SESSION_ID"),\"lastAssistantText\":$LAST_JSON}"
else
  printf '%s\n' "$LAST_TEXT"
fi
