#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/registry.sh"

usage() {
  cat <<'EOF'
Usage:
  status.sh [--name <name>] [--cwd <dir>] [--wait] [--timeout <seconds>] [--json]

Outputs JSON describing agents and optionally changes when waiting.
EOF
}

NAME=""
CWD=$(pwd)
WAIT=0
TIMEOUT=300
JSON_OUT=1

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --name) NAME="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --wait) WAIT=1; shift 1 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --json) JSON_OUT=1; shift 1 ;;
    *) usage >&2; printf '%s\n' '{"ok":false,"error":"Unknown argument"}'; exit 1 ;;
  esac
done

CWD=$(cd "$CWD" && pwd)

refresh_agents() {
  latest=$(registry_read_latest_json "$CWD")
  refreshed=$(registry_refresh_status_json "$latest")
  if [ -n "$NAME" ]; then
    printf '%s' "$refreshed" | osascript -l JavaScript \
      -e "ObjC.import('Foundation');" \
      -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
      -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
      -e "const input=readStdin().trim(); const data=input?JSON.parse(input):{ok:true,agents:[]}; const name=getLastArg(1); const arr=(data.agents||[]).filter(a=>a&&a.name===name); JSON.stringify({ok:true,agents:arr});" \
      -- "$NAME"
    return 0
  fi
  printf '%s\n' "$refreshed"
}

if [ "$WAIT" -eq 0 ]; then
  refreshed=$(refresh_agents)
  printf '%s\n' "$refreshed"
  exit 0
fi

# Wait mode: poll every 0.5s until a status changes or timeout.
deadline=$(( $(date +%s) + ${TIMEOUT:-300} ))
prev=$(refresh_agents)
while :; do
  sleep 0.5
  now=$(refresh_agents)
  changed=$(printf '%s\n%s\n' "$prev" "$now" | osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "const input=readStdin().split(/\n/); const prev=JSON.parse(input[0]||'{\"agents\":[]}'); const now=JSON.parse(input[1]||'{\"agents\":[]}');" \
    -e "const byName=(arr)=>{ const m=new Map(); for(const a of (arr||[])){ if(a && typeof a.name==='string') m.set(a.name,a); } return m; };" \
    -e "const p=byName(prev.agents), n=byName(now.agents); const diff=[];" \
    -e "for(const [name,curr] of n){ const pr=p.get(name); if(pr && pr.status!==curr.status){ diff.push({name,previousStatus:pr.status,status:curr.status,exitCode:(curr.exitCode!==undefined?curr.exitCode:null),sessionId:(curr.sessionId!==undefined?curr.sessionId:null),finishedAt:(curr.finishedAt!==undefined?curr.finishedAt:null)}); } } JSON.stringify(diff);"
  )
  if [ "$changed" != "[]" ]; then
    printf '%s' "$now" | osascript -l JavaScript \
      -e "ObjC.import('Foundation');" \
      -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
      -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
      -e "const full=JSON.parse(readStdin()||'{\"ok\":true,\"agents\":[]}'); const changed=JSON.parse(String(getLastArg(1))); full.changed=changed; full.ok=true; JSON.stringify(full);" \
      -- "$changed"
    exit 0
  fi
  prev="$now"
  if [ "$TIMEOUT" -gt 0 ] && [ $(date +%s) -ge "$deadline" ]; then
    printf '%s\n' "$prev" | osascript -l JavaScript \
      -e "ObjC.import('Foundation');" \
      -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
      -e "const full=JSON.parse(readStdin()); full.changed=[]; full.ok=true; JSON.stringify(full);"
    exit 0
  fi
done
