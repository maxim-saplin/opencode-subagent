#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  run_subagent.sh --name <logicalName> --prompt <text> [--resume] [--agent <name>] [--model <provider/model>]
                 [--file <path> ...] [--cwd <dir>] [--attach <url>] [--async]

Output:
  Writes a single JSON object to stdout.

Notes:
  - Uses title prefix "persistent-subagent: " by default.
  - Stores name->sessionId mapping in .opencode-persistent-subagent/index.tsv under --cwd.
EOF
}

NAME=""
PROMPT=""
RESUME=0
AGENT=""
MODEL=""
CWD=$(pwd)
ATTACH=""
ASYNC=0
TITLE_PREFIX="$TITLE_PREFIX_DEFAULT"
FILES_TMP=""
EXPORT_TMP=""

cleanup() {
  [ -n "${FILES_TMP:-}" ] && [ -f "$FILES_TMP" ] && rm -f "$FILES_TMP" || true
  [ -n "${EXPORT_TMP:-}" ] && [ -f "$EXPORT_TMP" ] && rm -f "$EXPORT_TMP" || true
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
      if [ -z "$FILES_TMP" ]; then
        FILES_TMP=$(mktemp -t opencode-subagent-files.XXXXXX)
      fi
      printf '%s\n' "$2" >> "$FILES_TMP"
      shift 2
      ;;
    --cwd) CWD="$2"; shift 2 ;;
    --attach) ATTACH="$2"; shift 2 ;;
    --async) ASYNC=1; shift 1 ;;
    --title-prefix) TITLE_PREFIX="$2"; shift 2 ;;
    *)
      usage >&2
      die "Unknown argument: $1" "Use --help to see supported flags."
      ;;
  esac
done

[ -n "$NAME" ] || die "--name is required"
[ -n "$PROMPT" ] || die "--prompt is required"

require_cmd opencode
require_cmd osascript

CWD=$(cd "$CWD" && pwd)
INDEX=$(index_path "$CWD")
TITLE="${TITLE_PREFIX}${NAME}"
UPDATED_AT=$(utc_now_iso)

MODE="new"
SESSION_ID=""

if [ "$RESUME" -eq 1 ]; then
  MODE="resume"
  SESSION_ID=$(index_get_session_id "$INDEX" "$NAME" || true)
  if [ -z "$SESSION_ID" ]; then
    # best-effort: lookup by title
    SESSION_ID=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
    if [ -n "$SESSION_ID" ]; then
      index_set_session "$INDEX" "$NAME" "$SESSION_ID" "$TITLE" "$UPDATED_AT"
    else
      die "No existing session found for name '$NAME'" "Start a new one first (omit --resume), or ensure the index file persists across runs."
    fi
  fi
fi

set -- opencode run "$PROMPT" --title "$TITLE"
if [ -n "$AGENT" ]; then set -- "$@" --agent "$AGENT"; fi
if [ -n "$MODEL" ]; then set -- "$@" --model "$MODEL"; fi
if [ -n "$ATTACH" ]; then set -- "$@" --attach "$ATTACH"; fi
if [ -n "$SESSION_ID" ]; then set -- "$@" --session "$SESSION_ID"; fi
if [ -n "$FILES_TMP" ] && [ -f "$FILES_TMP" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    set -- "$@" --file "$f"
  done < "$FILES_TMP"
fi

if [ "$ASYNC" -eq 1 ]; then
  # Run in background, then attempt to discover session id by title.
  # We intentionally discard output to keep orchestrator output clean.
  (cd "$CWD" && "$@" >/dev/null 2>/dev/null) &
  PID=$!

  # Poll for session id (best-effort)
  i=0
  DISCOVERED=""
  while [ $i -lt 40 ]; do
    DISCOVERED=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
    [ -n "$DISCOVERED" ] && break
    i=$((i + 1))
    sleep 0.5
  done

  if [ -n "$DISCOVERED" ]; then
    index_set_session "$INDEX" "$NAME" "$DISCOVERED" "$TITLE" "$UPDATED_AT"
  fi

  printf '%s\n' "{\"ok\":true,\"name\":$(json_quote "$NAME"),\"title\":$(json_quote "$TITLE"),\"mode\":$(json_quote "$MODE"),\"async\":true,\"pid\":$PID,\"sessionId\":$(json_quote "$DISCOVERED"),\"exportAvailable\":false,\"lastAssistantText\":null}"
  exit 0
fi

# Synchronous
if ! (cd "$CWD" && "$@" >/dev/null); then
  die "opencode run failed" "Run with OPENCODE_LOG_LEVEL=DEBUG or 'opencode --print-logs' to diagnose."
fi

# discover session id for new runs
if [ -z "$SESSION_ID" ]; then
  i=0
  while [ $i -lt 40 ]; do
    SESSION_ID=$(opencode session list --format json 2>/dev/null | json_find_latest_session_id_by_title "$TITLE" || true)
    [ -n "$SESSION_ID" ] && break
    i=$((i + 1))
    sleep 0.5
  done
fi

[ -n "$SESSION_ID" ] || die "Could not discover sessionId for run" "Try: opencode session list --format json and find the session by title."

index_set_session "$INDEX" "$NAME" "$SESSION_ID" "$TITLE" "$UPDATED_AT"

EXPORT_AVAILABLE=false
LAST_TEXT=""
EXPORT_TMP=$(mktemp -t opencode-subagent-export.XXXXXX)
(cd "$CWD" && opencode export "$SESSION_ID" > "$EXPORT_TMP" 2>/dev/null) || true
if [ -s "$EXPORT_TMP" ]; then
  EXPORT_AVAILABLE=true
  LAST_TEXT=$(cat "$EXPORT_TMP" | json_extract_last_assistant_text || true)
fi

if [ -n "$LAST_TEXT" ]; then
  LAST_JSON=$(json_quote "$LAST_TEXT")
else
  LAST_JSON=null
fi

printf '%s\n' "{\"ok\":true,\"name\":$(json_quote "$NAME"),\"title\":$(json_quote "$TITLE"),\"sessionId\":$(json_quote "$SESSION_ID"),\"mode\":$(json_quote "$MODE"),\"async\":false,\"exportAvailable\":$EXPORT_AVAILABLE,\"lastAssistantText\":$LAST_JSON}"
