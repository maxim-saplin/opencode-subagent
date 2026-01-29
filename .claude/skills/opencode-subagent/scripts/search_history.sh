#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  search_history.sh (--name <logicalName> | --session <sessionId>) --pattern <regex> [--role any|user|assistant] [--cwd <dir>] [--json]

Default output:
  One match per line:
    [#<i> <role>] <snippet>

With --json:
  Prints { ok, sessionId, matches: [...] }.
EOF
}

NAME=""
SESSION_ID=""
PATTERN=""
ROLE="any"
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
    --pattern) PATTERN="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift 1 ;;
    --title-prefix) TITLE_PREFIX="$2"; shift 2 ;;
    *)
      usage >&2
      die "Unknown argument: $1" "Use --help to see supported flags."
      ;;
  esac
done

[ -n "$PATTERN" ] || die "--pattern is required"

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
MATCHES_JSON='[]'
if [ -s "$EXPORT_TMP" ]; then
  MATCHES_JSON=$(cat "$EXPORT_TMP" | json_search_history "$PATTERN" "$ROLE")
fi

if [ "$JSON_MODE" -eq 1 ]; then
  printf '%s\n' "{\"ok\":true,\"sessionId\":$(json_quote "$SESSION_ID"),\"matches\":$MATCHES_JSON}"
else
  # Render matches JSON array into lines via osascript
  printf '%s' "$MATCHES_JSON" | osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;" \
    -e "const input=$.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js.trim();" \
    -e "if(!input){ ''; } else { const arr=JSON.parse(input); let out=''; for (const m of arr){ out += ('[#'+m.index+' '+m.role+'] '+m.snippet+'\\n'); } out; }"
fi
