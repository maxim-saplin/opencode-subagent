# opencode-subagent

## 0.3.0 (v3)

- Node-based CLI with .sh wrappers preserved for compatibility.
- Atomic mutable registry at .opencode-subagent/registry.json.
- Added wait-terminal status mode, result wait/timeout, and strict cancel semantics.
- Updated deterministic tests for registry and new flags.

## 0.2.0 (v2)

- Async-only subagent lifecycle with JSONL registry (`runs.jsonl`).
- Script set: `run_subagent.sh`, `status.sh`, `result.sh`, `search.sh`, `cancel.sh`.
- Deterministic non-LLM test suite and LLM gating/stability checks.
- Updated v2 skill definition and docs.
