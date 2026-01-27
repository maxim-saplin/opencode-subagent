#!/usr/bin/env sh

set -eu

TITLE_PREFIX_DEFAULT='persistent-subagent: '
INDEX_DIR_DEFAULT='.opencode-persistent-subagent'
INDEX_FILE_DEFAULT='index.tsv'

log() {
  # stderr to keep stdout machine-readable when needed
  printf '%s\n' "$*" >&2
}

die() {
  msg="$1"
  hint="${2:-}"
  if [ -n "$hint" ]; then
    printf '%s\n' "{\"ok\":false,\"error\":$(json_quote "$msg"),\"details\":{\"hint\":$(json_quote "$hint")}}"
  else
    printf '%s\n' "{\"ok\":false,\"error\":$(json_quote "$msg")}"
  fi
  exit 1
}

json_quote() {
  # JSON string escape using osascript (macOS)
  osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "const args=$.NSProcessInfo.processInfo.arguments;" \
    -e "const s=args.objectAtIndex(args.count-1).js;" \
    -e "JSON.stringify(String(s));" \
    "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing required command: $1" "Install '$1' and ensure it is on PATH."
  fi
}

index_path() {
  cwd="$1"
  index_dir="${INDEX_DIR:-$INDEX_DIR_DEFAULT}"
  index_file="${INDEX_FILE:-$INDEX_FILE_DEFAULT}"
  printf '%s/%s/%s' "$cwd" "$index_dir" "$index_file"
}

index_get_session_id() {
  index="$1"
  name="$2"
  [ -f "$index" ] || return 1
  awk -F '\t' -v n="$name" '$1==n {print $2; exit 0}' "$index" 2>/dev/null | head -n 1
}

index_set_session() {
  index="$1"
  name="$2"
  session_id="$3"
  title="$4"
  updated_at="$5"

  dir=$(dirname "$index")
  mkdir -p "$dir"

  tmp="$index.tmp.$$"
  if [ -f "$index" ]; then
    awk -F '\t' -v OFS='\t' -v n="$name" '$1!=n {print $0}' "$index" > "$tmp" || true
  else
    : > "$tmp"
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$session_id" "$title" "$updated_at" >> "$tmp"
  mv "$tmp" "$index"
}

utc_now_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# Reads JSON from stdin and prints the latest session id whose title matches.
# Input schema tolerated:
# - array of objects
# - object with .sessions array
json_find_latest_session_id_by_title() {
  title="$1"
  osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
    -e "const title=getLastArg(1); const input=readStdin().trim(); let out='';" \
    -e "if(input){ let data; try{ data=JSON.parse(input);}catch(e){ const start=input.indexOf('{')!==-1?input.indexOf('{'):input.indexOf('['); const end=Math.max(input.lastIndexOf('}'),input.lastIndexOf(']')); if(start>=0&&end>=0){ data=JSON.parse(input.slice(start,end+1)); } else { throw e; } }" \
    -e "  let sessions=data; if (sessions && typeof sessions==='object' && !Array.isArray(sessions) && Array.isArray(sessions.sessions)) sessions=sessions.sessions;" \
    -e "  if(Array.isArray(sessions)){ let best=null; for (const s of sessions){ if(!s||typeof s!=='object') continue; if(s.title!==title) continue; const id=s.id||s.sessionId; if(!id||typeof id!=='string') continue; const ts=(typeof s.updated==='number' ? s.updated : (typeof s.created==='number' ? s.created : null)); if(!best){ best={ts,id}; continue; } if(best.ts===null && ts!==null) best={ts,id}; else if(best.ts!==null && ts!==null && ts>best.ts) best={ts,id}; else if(best.ts===null && ts===null) best={ts,id}; } if(best) out=best.id; } }" \
    -e "out;" \
    "$title"
}

# Reads export JSON from stdin and prints last assistant text.
json_extract_last_assistant_text() {
  osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "function walk(node,fn){ if(node===null||node===undefined) return; if(Array.isArray(node)){ for(const it of node) walk(it,fn); return; } if(typeof node==='object'){ fn(node); for(const k of Object.keys(node)) walk(node[k],fn); } }" \
    -e "function coerceContent(c){ if(typeof c==='string') return c; if(Array.isArray(c)){ let out=''; for(const p of c){ if(typeof p==='string') out+=p; else if(p && typeof p==='object' && typeof p.text==='string') out+=p.text; } return out; } return null; }" \
    -e "const input=readStdin().trim(); let out='';" \
    -e "if(input){ let data; try{ data=JSON.parse(input);}catch(e){ const start=input.indexOf('{')!==-1?input.indexOf('{'):input.indexOf('['); const end=Math.max(input.lastIndexOf('}'),input.lastIndexOf(']')); if(start>=0&&end>=0) data=JSON.parse(input.slice(start,end+1)); else throw e; }" \
    -e "  if (data && typeof data==='object' && Array.isArray(data.messages)) {" \
    -e "    for (const m of data.messages) {" \
    -e "      if(!m||typeof m!=='object') continue;" \
    -e "      const role = (m.info && typeof m.info==='object' ? m.info.role : m.role);" \
    -e "      if (role !== 'assistant') continue;" \
    -e "      let text='';" \
    -e "      if (Array.isArray(m.parts)) {" \
    -e "        const textParts = m.parts.filter(p => p && typeof p==='object' && p.type==='text' && typeof p.text==='string').map(p => p.text);" \
    -e "        if (textParts.length) text = textParts.join('');" \
    -e "        else { const anyParts = m.parts.filter(p => p && typeof p==='object' && typeof p.text==='string').map(p => p.text); if (anyParts.length) text = anyParts.join(''); }" \
    -e "      }" \
    -e "      if (text) out = String(text).trim();" \
    -e "    }" \
    -e "  } else {" \
    -e "    let last=null; walk(data,(obj)=>{ if(!obj||typeof obj!=='object') return; if(obj.role==='assistant'){ const c=coerceContent(obj.content); if(c!==null) last=c; } }); if(last!==null) out=String(last).trim();" \
    -e "  }" \
    -e " }" \
    -e "out;"
}

# Reads export JSON from stdin, prints JSON array of matches.
json_search_history() {
  pattern="$1"
  role="$2" # any|user|assistant

  osascript -l JavaScript \
    -e "ObjC.import('Foundation');" \
    -e "function readStdin(){ const d=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return $.NSString.alloc.initWithDataEncoding(d,$.NSUTF8StringEncoding).js; }" \
    -e "function getLastArg(n){ const a=$.NSProcessInfo.processInfo.arguments; return a.objectAtIndex(a.count-n).js; }" \
    -e "function walk(node,fn){ if(node===null||node===undefined) return; if(Array.isArray(node)){ for(const it of node) walk(it,fn); return; } if(typeof node==='object'){ fn(node); for(const k of Object.keys(node)) walk(node[k],fn); } }" \
    -e "function coerceContent(c){ if(typeof c==='string') return c; if(Array.isArray(c)){ let out=''; for(const p of c){ if(typeof p==='string') out+=p; else if(p && typeof p==='object' && typeof p.text==='string') out+=p.text; } return out; } return null; }" \
    -e "function snip(t,maxLen){ const s=String(t).replace(/\\s+/g,' ').trim(); return s.length<=maxLen?s:(s.slice(0,maxLen-1)+'…'); }" \
    -e "const pattern=getLastArg(2); const roleFilter=getLastArg(1); const rx=new RegExp(pattern);" \
    -e "const input=readStdin().trim(); let out='[]';" \
    -e "if(input){ let data; try{ data=JSON.parse(input);}catch(e){ const start=input.indexOf('{')!==-1?input.indexOf('{'):input.indexOf('['); const end=Math.max(input.lastIndexOf('}'),input.lastIndexOf(']')); if(start>=0&&end>=0) data=JSON.parse(input.slice(start,end+1)); else throw e; }" \
    -e "  const matches=[];" \
    -e "  if (data && typeof data==='object' && Array.isArray(data.messages)) {" \
    -e "    let i=0;" \
    -e "    for (const m of data.messages) {" \
    -e "      if(!m||typeof m!=='object') { i+=1; continue; }" \
    -e "      const r = (m.info && typeof m.info==='object' ? m.info.role : m.role) || 'unknown';" \
    -e "      if(roleFilter!=='any' && r!==roleFilter){ i+=1; continue; }" \
    -e "      let text='';" \
    -e "      if (Array.isArray(m.parts)) {" \
    -e "        const textParts = m.parts.filter(p => p && typeof p==='object' && p.type==='text' && typeof p.text==='string').map(p => p.text);" \
    -e "        if (textParts.length) text = textParts.join('');" \
    -e "        else { const anyParts = m.parts.filter(p => p && typeof p==='object' && typeof p.text==='string').map(p => p.text); if (anyParts.length) text = anyParts.join(''); }" \
    -e "      }" \
    -e "      if (rx.test(text || '')) matches.push({index:i, role:r, snippet:snip(text,200)});" \
    -e "      i += 1;" \
    -e "    }" \
    -e "  } else {" \
    -e "    let i=0; walk(data,(obj)=>{ if(!obj||typeof obj!=='object') return; if(typeof obj.role==='string' && obj.content!==undefined){ const r=obj.role; if(roleFilter!=='any' && r!==roleFilter){ i+=1; return; } const c=coerceContent(obj.content) ?? ''; if(rx.test(c)) matches.push({index:i, role:r, snippet:snip(c,200)}); i+=1; } });" \
    -e "  }" \
    -e "  out=JSON.stringify(matches); }" \
    -e "out;" \
    "$pattern" "$role"
}
