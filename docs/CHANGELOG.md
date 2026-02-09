# opencode-subagent

## 0.3.1 (v4)

- Added status daemon with cached usage and ASCII dashboard output.
- Split user-facing dashboard into `status_watch.sh`.
- Minimized `status` output to essential fields (no prompt/stderr/sessionId).
- Removed `--json` from `status`, `search`, and `cancel` (always JSON).
- Updated deterministic tests and docs to match the v4 contract.

## 0.3.0 (v4)

- Node-based CLI with .sh wrappers preserved for compatibility.
- Atomic mutable registry at .opencode-subagent/registry.json.
- Added wait-terminal status mode, result wait/timeout, and strict cancel semantics.
- Updated deterministic tests for registry and new flags.

## 0.2.0 (v2)

- Async-only subagent lifecycle with JSONL registry (`runs.jsonl`).
- Script set: `run_subagent.sh`, `status.sh`, `result.sh`, `search.sh`, `cancel.sh`.
- Deterministic non-LLM test suite and LLM gating/stability checks.
- Updated v2 skill definition and docs.
