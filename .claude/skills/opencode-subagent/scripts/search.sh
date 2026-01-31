#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  search.sh --name <name> --pattern <regex> [--role any|user|assistant] [--cwd <dir>] [--json]

Default output:
  Prints JSON: { ok, name, sessionId, matches: [...] }.
EOF
}

NAME=""
PATTERN=""
ROLE="any"
CWD=$(pwd)
JSON_MODE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --pattern) PATTERN="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift 1 ;;
    *) usage >&2; printf '%s\n' '{"ok":false,"error":"Unknown argument"}'; exit 1 ;;
  esac
done

require_cmd opencode
require_cmd osascript

[ -n "$NAME" ] || { printf '%s\n' '{"ok":false,"error":"--name is required"}'; exit 1; }
[ -n "$PATTERN" ] || { printf '%s\n' '{"ok":false,"error":"--pattern is required"}'; exit 1; }

CWD=$(cd "$CWD" && pwd)

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

[ -n "$sid" ] || { printf '%s\n' '{"ok":false,"error":"No session found for name"}'; exit 1; }

EXPORT_TMP=$(mktemp -t opencode-subagent-export.XXXXXX)
(cd "$CWD" && opencode export "$sid" > "$EXPORT_TMP" 2>/dev/null) || true
MATCHES_JSON='[]'
if [ -s "$EXPORT_TMP" ]; then
  MATCHES_JSON=$(cat "$EXPORT_TMP" | json_search_history "$PATTERN" "$ROLE")
fi
rm -f "$EXPORT_TMP"

printf '%s\n' "{\"ok\":true,\"name\":$(json_quote "$name"),\"sessionId\":$(json_quote "$sid"),\"matches\":$MATCHES_JSON}"
