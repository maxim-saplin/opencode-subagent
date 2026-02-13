# opencode-subagent

## 5.0.4 (v5)

- Added task-tool child tracking in the status daemon: parent exports are scanned for `tool:"task"` parts, child session IDs are extracted, and child token usage is read from OpenCode local storage.
- Extended `status --diagram` to render indented task-child rows under parent agents, including child status, model, runtime, and usage columns.
- Added non-LLM daemon coverage for task-child discovery/usage, and mock-opencode `MOCK:TASK` support that emits task tool parts plus synthetic child storage messages.

## 5.0.3 (v5)

- **B-023**: `DIALOG_TKN` now includes cached input tokens (`tokens.cache.read`) in addition to non-cached input tokens. Previously only `tokens.input` was reported, drastically understating dialog size when prompt caching was active (e.g. 565 reported vs 9397 actual).
- Added LLM test `L11` (`tests/llm/dialog_tokens.spec.ts`) verifying dialog token accounting with cache.read.

## 5.0.2 (v5)

- **B-022-A**: FULL column now populated via `opencode models --verbose` context window cache built at daemon startup, since real opencode exports lack context window metadata.
- **B-022-B**: DIALOG_TKN no longer shows `0` while running; `extractDialogTokens` skips assistant messages with `tokens.input === 0` (not yet finalized).
- **B-022-C**: Resume without `--model` now inherits model and variant from the existing registry record instead of falling back to the default model.
- Mock alignment: removed `contextWindow` from mock export output; added `models --verbose` command to mock.
- Added RESUMED column to `status --diagram` showing resume count per agent.

## 5.0.1 (v5)

- **B-019**: Added `--variant` flag pass-through to opencode CLI for reasoning effort control. Falls back to `OPENCODE_PSA_VARIANT` env var. Stored in registry records and output JSON.
- **B-020**: Added MODEL column to `status --diagram` table (shows `provider/model-variant`). Renamed DIALOG column to DIALOG_TKN. Added `model` and `variant` to sanitized status output.

## 5.0.0 (v5)

- **Breaking**: Split `run_subagent.sh` into `start_subagent.sh` and `resume_subagent.sh`.
- **Breaking**: Removed `--timeout` from status (use `OPENCODE_PSA_WAIT_TIMEOUT_SEC` env, default 100).
- **Breaking**: Removed `--wait` and `--timeout` from result; result is now sync-only (returns status when agent is running).
- **Fix**: Export now writes to a temp file instead of a pipe, avoiding 128 KB stdout truncation.

## 4.0.0 (v4)

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
