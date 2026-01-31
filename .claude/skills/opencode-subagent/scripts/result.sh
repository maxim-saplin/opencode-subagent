#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  result.sh --name <name> [--cwd <dir>] [--json]

Default output:
  Prints last assistant message text.

With --json:
  Prints { ok, name, sessionId, status, lastAssistantText }.
EOF
}

NAME=""
CWD=$(pwd)
JSON_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift 1 ;;
    *) usage >&2; printf '%s\n' '{"ok":false,"error":"Unknown argument"}'; exit 1 ;;
  esac
done

require_cmd opencode
require_cmd osascript

CWD=$(cd "$CWD" && pwd)

[ -n "$NAME" ] || { printf '%s\n' '{"ok":false,"error":"--name is required"}'; exit 1; }

# Resolve latest record for name
latest=$(registry_read_latest_json "$CWD")
record=$(printf '%s' "$latest" | osascript -l JavaScript \
  -e "ObjC.import('Foundation');" \
  -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
  -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
  -e "const input=readStdin().trim(); const data=input?JSON.parse(input):{ok:true,agents:[]}; const name=getLastArg(1); const a=(data.agents||[]).find(x=>x&&x.name===name); JSON.stringify(a||null);" \
  -- "$NAME")

[ "$record" != "null" ] || { printf '%s\n' '{"ok":false,"error":"No session found for name"}'; exit 1; }
sid=$(printf '%s' "$record" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
status=$(printf '%s' "$record" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
name="$NAME"

EXPORT_TMP=$(mktemp -t opencode-subagent-export.XXXXXX)
(cd "$CWD" && opencode export "$sid" > "$EXPORT_TMP" 2>/dev/null) || true
LAST_TEXT=""
if [ -s "$EXPORT_TMP" ]; then
  LAST_TEXT=$(cat "$EXPORT_TMP" | json_extract_last_assistant_text || true)
fi
rm -f "$EXPORT_TMP"

if [ "$JSON_MODE" -eq 1 ]; then
  nt_json=$(json_quote "$name")
  st_json=$(json_quote "$status")
  sid_json=$(json_quote "$sid")
  if [ -n "$LAST_TEXT" ]; then lt_json=$(json_quote "$LAST_TEXT"); else lt_json=null; fi
  printf '%s\n' "{\"ok\":true,\"name\":$nt_json,\"sessionId\":$sid_json,\"status\":$st_json,\"lastAssistantText\":$lt_json}"
else
  printf '%s\n' "$LAST_TEXT"
fi
