#!/usr/bin/env sh

set -eu

# JSONL registry utilities for v2 contract
# Location: <cwd>/${OPENCODE_PSA_DIR:-.opencode-subagent}/runs.jsonl

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "{\"ok\":false,\"error\":\"Missing required command: $1\",\"details\":{\"hint\":\"Install '$1' and ensure it is on PATH.\"}}"
    exit 1
  fi
}

json_quote() {
  osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "const args=$.NSProcessInfo.processInfo.arguments; const s=args.objectAtIndex(args.count-1).js; JSON.stringify(String(s));" \
    -- "$1"
}

utc_now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

registry_dir() {
  dir="${OPENCODE_PSA_DIR:-.opencode-subagent}"
  printf '%s/%s' "$1" "$dir"
}

registry_path() {
  printf '%s/runs.jsonl' "$(registry_dir "$1")"
}

registry_atomic_append() {
  path="$1"
  line="$2"
  dir=$(dirname "$path")
  mkdir -p "$dir"
  tmp="$path.tmp.$$"
  : > "$tmp"
  if [ -f "$path" ]; then
    cat "$path" >> "$tmp"
    # Ensure newline separation
    if [ -s "$path" ]; then
      lastchar=$(tail -c 1 "$path" 2>/dev/null || true)
      if [ "$lastchar" != "" ] && [ "$lastchar" != $'\n' ]; then
        printf '\n' >> "$tmp"
      fi
    fi
  fi
  printf '%s\n' "$line" >> "$tmp"
  mv "$tmp" "$path"
}

registry_write_record() {
  cwd="$1"; name="$2"; pid="$3"; sessionId="$4"; status="$5"; exitCode="$6"; startedAt="$7"; updatedAt="$8"; finishedAt="$9"; model="${10}"; prompt="${11}";
  path="$(registry_path "$cwd")"
  n_json=$(json_quote "$name")
  s_json=$([ -n "$sessionId" ] && json_quote "$sessionId" || printf 'null')
  m_json=$([ -n "$model" ] && json_quote "$model" || printf 'null')
  p_json=$([ -n "$prompt" ] && json_quote "$prompt" || printf 'null')
  f_json=$([ -n "$finishedAt" ] && json_quote "$finishedAt" || printf 'null')
  u_json=$([ -n "$updatedAt" ] && json_quote "$updatedAt" || printf 'null')
  st_json=$([ -n "$startedAt" ] && json_quote "$startedAt" || printf 'null')
  ec_json=$([ -n "$exitCode" ] && printf '%s' "$exitCode" || printf 'null')
  pid_json=$([ -n "$pid" ] && printf '%s' "$pid" || printf 'null')
  line="{\"name\":$n_json,\"pid\":$pid_json,\"sessionId\":$s_json,\"status\":\"$status\",\"exitCode\":$ec_json,\"startedAt\":$st_json,\"updatedAt\":$u_json,\"finishedAt\":$f_json,\"model\":$m_json,\"prompt\":$p_json,\"cwd\":$(json_quote "$cwd")}"
  registry_atomic_append "$path" "$line"
}

# Read latest records per name (latest by name wins).
# Prints a JSON object: { ok:true, agents:[...] }
registry_read_latest_json() {
  cwd="$1"
  path="$(registry_path "$cwd")"
  if [ ! -f "$path" ]; then
    printf '%s\n' '{"ok":true,"agents":[]}'
    return 0
  fi
  cat "$path" | osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "const input=readStdin().trim(); const out={ok:true,agents:[]};" \
    -e "if(input){ const lines=input.split(/\r?\n/); const map=new Map(); const order=[]; const index=new Map();" \
    -e "for(const ln of lines){ const t=ln.trim(); if(!t) continue; let obj; try{ obj=JSON.parse(t);}catch(e){ continue; } if(!obj||typeof obj.name!=='string') continue; const name=obj.name;" \
    -e "if(index.has(name)){ order[index.get(name)]=null; } index.set(name, order.length); order.push(name); map.set(name,obj); }" \
    -e "out.agents=order.filter(n=>n!==null).map(n=>map.get(n)); }" \
    -e "JSON.stringify(out);"
}

# Refresh status for scheduled/running by checking PID liveness.
# Input: JSON from registry_read_latest_json; Output: same shape with refreshed statuses.
registry_refresh_status_json() {
  now=$(utc_now_iso)
  input="${1:-}"
  if [ -z "$input" ]; then
    input=$(cat)
  fi
  printf '%s' "$input" | osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "const app=Application.currentApplication(); app.includeStandardAdditions = true;" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
    -e "const now=String(getLastArg(1));" \
    -e "const input=readStdin().trim(); let data={ok:true,agents:[]}; if(input){ try{ data=JSON.parse(input);}catch(e){ data={ok:false,agents:[]}; } }" \
    -e "const agents=Array.isArray(data.agents)?data.agents:[]; const out=[];" \
    -e "for(const a of agents){ if(!a||typeof a!=='object') continue; const b=Object.assign({}, a); const status=String(a.status||''); const pidNum=Number(a.pid);" \
    -e "if(status==='scheduled' || status==='running'){ if(Number.isFinite(pidNum) && pidNum>0){ let alive=false; try{ app.doShellScript('kill -0 ' + String(pidNum)); alive=true; }catch(e){ alive=false; } if(alive){ if(status!=='running'){ b.status='running'; b.updatedAt=now; } } else { if(status!=='done'){ b.status='unknown'; b.updatedAt=now; if(b.finishedAt===undefined) b.finishedAt=null; if(b.exitCode===undefined) b.exitCode=null; } } } else if(status==='running'){ b.status='unknown'; b.updatedAt=now; if(b.finishedAt===undefined) b.finishedAt=null; if(b.exitCode===undefined) b.exitCode=null; } } out.push(b); }" \
    -e "data.agents=out; data.ok=true; JSON.stringify(data);" \
    -- "$now"
}
