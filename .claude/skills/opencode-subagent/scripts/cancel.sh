#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"

usage() {
  cat <<'EOF'
Usage:
  cancel.sh --name <name> [--cwd <dir>] [--signal <sig>] [--json]
EOF
}

NAME=""
CWD=$(pwd)
SIGNAL="TERM"
JSON_OUT=1

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --signal) SIGNAL="$2"; shift 2 ;;
    --json) JSON_OUT=1; shift 1 ;;
    *) usage >&2; printf '%s\n' '{"ok":false,"error":"Unknown argument"}'; exit 1 ;;
  esac
done

[ -n "$NAME" ] || { printf '%s\n' '{"ok":false,"error":"--name is required"}'; exit 1; }

CWD=$(cd "$CWD" && pwd)

latest=$(registry_read_latest_json "$CWD")
record=$(printf '%s' "$latest" | osascript -l JavaScript \
  -e "ObjC.import('Foundation');" \
  -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
  -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
  -e "const input=readStdin().trim(); const data=input?JSON.parse(input):{ok:true,agents:[]}; const name=getLastArg(1); const a=(data.agents||[]).find(x=>x&&x.name===name); JSON.stringify(a||null);" \
  -- "$NAME")

[ "$record" != "null" ] || { printf '%s\n' '{"ok":false,"error":"Agent not running"}'; exit 1; }
pid=$(printf '%s' "$record" | sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p')
prevStatus=$(printf '%s' "$record" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')

if [ -z "$pid" ]; then
  i=0
  while [ $i -lt 10 ]; do
    sleep 0.2
    latest=$(registry_read_latest_json "$CWD")
    record=$(printf '%s' "$latest" | osascript -l JavaScript \
      -e "ObjC.import('Foundation');" \
      -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
      -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
      -e "const input=readStdin().trim(); const data=input?JSON.parse(input):{ok:true,agents:[]}; const name=getLastArg(1); const a=(data.agents||[]).find(x=>x&&x.name===name); JSON.stringify(a||null);" \
      -- "$NAME")
    pid=$(printf '%s' "$record" | sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p')
    prevStatus=$(printf '%s' "$record" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
    [ -n "$pid" ] && break
    i=$((i+1))
  done
fi

if [ -z "$pid" ]; then
  printf '%s\n' '{"ok":false,"error":"Agent not running"}'
  exit 1
fi

case "$SIGNAL" in
  TERM|KILL) : ;;
  *) printf '%s\n' '{"ok":false,"error":"Unsupported signal"}'; exit 1 ;;
esac

if [ "$SIGNAL" = "TERM" ]; then
  kill -TERM "$pid" 2>/dev/null || true
else
  kill -KILL "$pid" 2>/dev/null || true
fi

printf '%s\n' "{\"ok\":true,\"name\":$(json_quote "$NAME"),\"pid\":$pid,\"signalSent\":$(json_quote "$SIGNAL"),\"previousStatus\":$(json_quote "$prevStatus")}"
