---
name: opencode-subagent
description: Async-only persistent OpenCode sessions via Node CLI + atomic registry, with .sh wrappers.
compatibility: POSIX (macOS/Linux). Requires opencode CLI and Node.js.
metadata:
  workflow: orchestration
  kind: subagent
  version: 3
---

# OpenCode Persistent Subagent (v3)

This skill runs **named, persistent, async-only** OpenCode sessions and provides a small CLI surface for orchestrators:

- Start a run (always async)
- Check status (sync or wait)
- Fetch last assistant output (safe/non-hanging)
- Search history
- Cancel running work

v3 keeps the existing `.sh` entrypoints for compatibility, but moves the logic into a single Node.js CLI.

## Requirements

- `opencode` CLI on `PATH`
- Node.js available as `node` (npm-installed or system-installed)

Dev/test:
- Bun is used only for the repository test suite.

## Entry points (stable)

These scripts are the public interface and should remain stable across versions:

- `.claude/skills/opencode-subagent/scripts/run_subagent.sh`
- `.claude/skills/opencode-subagent/scripts/status.sh`
- `.claude/skills/opencode-subagent/scripts/result.sh`
- `.claude/skills/opencode-subagent/scripts/search.sh`
- `.claude/skills/opencode-subagent/scripts/cancel.sh`

In v3 they are thin wrappers that invoke a single Node CLI.

## Registry (v3)

Location:

- `<cwd>/.opencode-subagent/registry.json`

Characteristics:

- Mutable “latest state per name” registry (not JSONL append-only)
- Updates are atomic (write temp + rename)
- Concurrent writers are protected by a lockfile (to avoid lost updates)

## Status model

| Status | Meaning |
|---|---|
| `scheduled` | A run record exists; worker not yet confirmed alive. |
| `running` | Worker PID is alive. |
| `done` | Worker exited; `exitCode` recorded. |
| `unknown` | PID is dead without clean completion record (crash/kill -9). |

## Commands

### run_subagent.sh

Start a named subagent session (always async).

Usage:

```sh
run_subagent.sh --name <name> --prompt <text> [--resume] [--cwd <dir>] \
  [--agent <agent>] [--model <provider/model>] [--file <path> ...]
```

Output: single JSON line.

Success:

```json
{"ok":true,"name":"pipeline/plan","pid":12345,"status":"scheduled","sessionId":null,"model":"opencode/gpt-5-nano","mode":"new","startedAt":"2026-02-02T12:00:00Z"}
```

Failure:

```json
{"ok":false,"code":"E_PROMPT_REQUIRED","error":"--prompt is required","details":{"hint":"Provide a non-empty prompt."}}
```

### status.sh

Query status (sync) or wait.

Usage:

```sh
status.sh [--name <name>] [--cwd <dir>] [--json] [--wait] [--timeout <seconds>] [--wait-terminal]
```

Semantics:

- `--wait`: returns when **any** agent status changes (legacy behavior).
- `--wait-terminal`: waits until the target `--name` reaches `done` or `unknown`.

### result.sh

Fetch the last assistant response.

Usage:

```sh
result.sh --name <name> [--cwd <dir>] [--json] [--wait] [--timeout <seconds>]
```

Hard guarantees:

- Never hangs indefinitely.
- If `sessionId` is missing and output cannot be retrieved safely, returns `ok:false` with a stable error code.

### search.sh

Search session history by regex.

Usage:

```sh
search.sh --name <name> --pattern <regex> [--role any|user|assistant] [--cwd <dir>] [--json]
```

### cancel.sh

Cancel a running subagent.

Usage:

```sh
cancel.sh --name <name> [--cwd <dir>] [--signal TERM|KILL] [--json]
```

v3 semantics:

- If the agent is not currently `running`, cancellation returns `ok:false` (no silent no-op).

## Error contract

All commands emit exactly one JSON line.

Common fields:

- `ok: boolean`
- `code: string` (stable, machine-readable)
- `error: string`
- `details?: object`

## Model notes for deterministic QA

Some models may refuse to echo strings that look like secrets. For stable testing, prefer prompts that clarify the string is a literal test token, or check that the token is present rather than exactly equal.
