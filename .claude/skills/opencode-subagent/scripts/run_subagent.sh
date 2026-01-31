#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  run_subagent.sh --name <name> --prompt <text> [--resume] [--agent <name>] [--model <provider/model>] [--file <path> ...] [--cwd <dir>]

Output:
  Writes a single JSON object to stdout (scheduled).
EOF
}

NAME=""
PROMPT=""
RESUME=0
AGENT=""
MODEL=""
CWD=$(pwd)
FILES_TMP=""

cleanup() {
  [ -n "${FILES_TMP:-}" ] && [ -f "$FILES_TMP" ] && rm -f "$FILES_TMP" || true
}

trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --resume) RESUME=1; shift 1 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --file)
      if [ -z "$FILES_TMP" ]; then FILES_TMP=$(mktemp -t opencode-subagent-files.XXXXXX); fi
      printf '%s\n' "$2" >> "$FILES_TMP"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    *) usage >&2; printf '%s\n' '{"ok":false,"error":"Unknown argument"}'; exit 1 ;;
  esac
done

[ -n "$NAME" ] || { printf '%s\n' '{"ok":false,"error":"--name is required","details":{"hint":"Provide a stable name."}}'; exit 1; }
[ -n "$PROMPT" ] || { printf '%s\n' '{"ok":false,"error":"--prompt is required","details":{"hint":"Provide a non-empty prompt."}}'; exit 1; }

require_cmd opencode
require_cmd osascript

CWD=$(cd "$CWD" && pwd)

# Default model from env or hard-coded default
if [ -z "$MODEL" ]; then
  MODEL="${OPENCODE_PSA_MODEL:-opencode/gpt-5-nano}"
fi

TITLE="persistent-subagent: $NAME"

# Resume: discover sessionId from registry or session list
SESSION_ID=""
MODE="new"
if [ "$RESUME" -eq 1 ]; then
  MODE="resume"
  latest=$(registry_read_latest_json "$CWD")
  SESSION_ID=$(printf '%s' "$latest" | osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
    -e "const input=readStdin(); const data=JSON.parse(input); const name=getLastArg(1); const arr=data.agents||[]; let sid=''; for(const a of arr){ if(a.name===name){ sid=a.sessionId||''; break; } } sid;" \
    -- "$NAME")
  if [ -z "$SESSION_ID" ]; then
    SESSION_ID=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
    [ -n "$SESSION_ID" ] || { printf '%s\n' '{"ok":false,"error":"No session found for name"}'; exit 1; }
  fi
fi

startedAt=$(utc_now_iso)
registry_write_record "$CWD" "$NAME" "" "" "scheduled" "" "$startedAt" "$startedAt" "" "$MODEL" "$PROMPT"

# Launch worker
FILES_FILE="$FILES_TMP" NAME="$NAME" PROMPT="$PROMPT" CWD="$CWD" TITLE="$TITLE" AGENT="$AGENT" MODEL="$MODEL" SESSION_ID="$SESSION_ID" "$SCRIPT_DIR/run_worker.sh" >/dev/null 2>&1 &
PID=$!

printf '%s\n' "{\"ok\":true,\"name\":$(json_quote "$NAME"),\"pid\":$PID,\"status\":\"scheduled\",\"sessionId\":null,\"model\":$(json_quote "$MODEL"),\"mode\":$(json_quote "$MODE"),\"startedAt\":$(json_quote "$startedAt") }"

