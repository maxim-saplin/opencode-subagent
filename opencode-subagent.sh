#!/usr/bin/env sh
# macOS-only subagent runner for OpenCode
# Usage:
#   ./opencode-subagent.sh "<prompt>" [model] [workdir]
#
# Defaults:
#   model  = opencode/gpt-5-nano
#   workdir = current directory

set -eu

PROMPT="${1:-}"
MODEL="${2:-opencode/gpt-5-nano}"
WORKDIR="${3:-$(pwd)}"

if [ -z "$PROMPT" ]; then
  echo "ERROR: prompt is required"
  echo "Usage: ./opencode-subagent.sh \"<prompt>\" [model] [workdir]"
  exit 2
fi

cd "$WORKDIR"

# Start subprocess
opencode run "$PROMPT" --model "$MODEL" &
PID=$!

echo "SUBAGENT_PID=$PID"
echo "SUBAGENT_STATUS=RUNNING"

# Poll until process exits
while kill -0 "$PID" 2>/dev/null; do
  sleep 2
done

wait "$PID"
EXIT_CODE=$?

echo "SUBAGENT_STATUS=ENDED"
echo "SUBAGENT_EXIT_CODE=$EXIT_CODE"

exit "$EXIT_CODE"