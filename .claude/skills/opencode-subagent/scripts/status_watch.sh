#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLI="$SCRIPT_DIR/../bin/opencode-subagent.js"
WATCH_SEC=${OPENCODE_PSA_WATCH_SEC:-2}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "{\"ok\":false,\"error\":\"Missing required command: $1\",\"details\":{\"hint\":\"Install '$1' and ensure it is on PATH.\"}}"
    exit 1
  fi
}

require_cmd node

exec node "$CLI" status --diagram --watch "$WATCH_SEC" "$@"
