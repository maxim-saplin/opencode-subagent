#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLI="$SCRIPT_DIR/../bin/opencode-subagent.js"
DEBOUNCE_SEC=2

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "{\"ok\":false,\"error\":\"Missing required command: $1\",\"details\":{\"hint\":\"Install '$1' and ensure it is on PATH.\"}}"
    exit 1
  fi
}

debounce_start() {
  if [ -n "${OPENCODE_MOCK_DIR:-}" ]; then
    return
  fi

  ROOT="$PWD"
  STATE_DIR="$ROOT/.opencode-subagent"
  LOCK_DIR="$STATE_DIR/start.lock"
  TS_FILE="$STATE_DIR/start.ts"

  mkdir -p "$STATE_DIR"

  deadline=$(( $(date +%s) + 5 ))
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      return
    fi
    sleep 0.1
  done

  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

  last=0
  if [ -f "$TS_FILE" ]; then
    last=$(cat "$TS_FILE" 2>/dev/null || echo 0)
  fi
  now=$(date +%s)
  if [ "$last" -gt 0 ]; then
    delta=$((now - last))
    if [ "$delta" -lt "$DEBOUNCE_SEC" ]; then
      sleep $((DEBOUNCE_SEC - delta))
    fi
  fi
  date +%s > "$TS_FILE"

  rmdir "$LOCK_DIR" 2>/dev/null || true
  trap - EXIT INT TERM
}

require_cmd node

debounce_start

exec node "$CLI" start "$@"
