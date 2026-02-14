---
name: opencode-subagent
description: Async resumable OpenCode agent sessions via CLI
compatibility: POSIX (macOS/Linux)
metadata:
  workflow: orchestration
  kind: subagent
---

Run OpenCode sessions. All runs are async (background). A JSON registry tracks lifecycle state reliably: `scheduled → running → done`. The orchestrator can introspect and resume `done` sessions with new instructions. Prefer this for long-running, complex sessions over one-off agent tools (like `Task`), which are designed for single outputs and cannot be resumed.

## Status model

| Status    | Meaning                                                      |
|-----------|--------------------------------------------------------------|
| scheduled | A run record exists; worker not yet confirmed alive.         |
| running   | Worker PID is alive.                                         |
| done      | Worker exited; exitCode recorded.                            |
| unknown   | PID is dead without clean completion record (crash/kill -9). |

## Entry points

- .claude/skills/opencode-subagent/scripts/start_subagent.sh
- .claude/skills/opencode-subagent/scripts/resume_subagent.sh
- .claude/skills/opencode-subagent/scripts/status.sh
- .claude/skills/opencode-subagent/scripts/result.sh
- .claude/skills/opencode-subagent/scripts/search.sh
- .claude/skills/opencode-subagent/scripts/cancel.sh

## Caveats

- Your orchestrator's tool call might have own timeouts, be ready to retry

## Commands

### start_subagent.sh

Start a new named subagent session (always async).

Usage:

```sh
start_subagent.sh --name <name> --prompt <text> [--cwd <dir>] \
  [--agent <agent>] [--model <provider/model>] [--variant <variant>] [--file <path> ...]
```

Output: single JSON line.

Success:

```json
{"ok":true,"name":"pipeline/plan","pid":12345,"status":"scheduled","model":"opencode/gpt-5-nano","mode":"new","startedAt":"2026-02-02T12:00:00Z"}
```

Failure:

```json
{"ok":false,"code":"E_PROMPT_REQUIRED","error":"--prompt is required","details":{"hint":"Provide a non-empty prompt."}}
```

Flags:

- --name <name>: stable address for the subagent session (required).
- --prompt <text>: message sent to the session (required).
- --cwd <dir>: working directory for opencode runs (default: $PWD). Registry is stored under the orchestrator working directory.
- --agent <agent>: OpenCode agent preset (e.g., plan, build).
- --model <provider/model>: model id (falls back to OPENCODE_PSA_MODEL).
- --variant <variant>: model variant / reasoning effort (e.g., high, low, minimal). Falls back to `OPENCODE_PSA_VARIANT`.
- --file <path>: attach local file(s) to the message (repeatable).

If the name already exists, the command returns `E_NAME_EXISTS`.

### resume_subagent.sh

Continue an existing session addressed by --name.

Usage:

```sh
resume_subagent.sh --name <name> --prompt <text> [--cwd <dir>]
```

Flags:

- --name <name>: stable address for the subagent session (required).
- --prompt <text>: message sent to the session (required).
- --cwd <dir>: must match existing record cwd if provided.

### status.sh

Query status (sync) or wait.

Usage:

```sh
status.sh [--name <name>] [--wait] [--wait-terminal]
```

Semantics:

- --wait: returns when any agent status changes (legacy behavior).
- --wait-terminal: waits until the target --name reaches done or unknown.
- --diagram: includes one-level task-tool child subagents (indented rows) discovered from parent exports and local OpenCode storage.

Timeout is configured via `OPENCODE_PSA_WAIT_TIMEOUT_SEC` (default: 100, 0 = forever).

Flags:

- --name <name>: filter to a specific subagent (omit for all).
- --wait: block until any status changes.
- --wait-terminal: wait until target reaches done or unknown (requires --name).

### result.sh

Fetch the last assistant response. Response is always sync.

Usage:

```sh
result.sh --name <name> [--json]
```

When agent is done or unknown: fetches and returns the last assistant text. When agent is running or scheduled: returns status immediately (`ok: true`, `status`, `lastAssistantText: null` in --json mode).

Hard guarantees:

- Never hangs indefinitely.
- If sessionId is missing and output cannot be retrieved safely, returns ok:false with a stable error code.

Flags:

- --name <name>: name of the subagent session (required).
- --json: output as JSON with metadata.

### search.sh

Search session history by regex.

Usage:

```sh
search.sh --name <name> --pattern <regex> [--role any|user|assistant]
```

Flags:

- --name <name>: name of the subagent session (required).
- --pattern <regex>: search pattern (required).
- --role <role>: filter by role: any (default), user, assistant.

### cancel.sh

Cancel a running subagent.

Usage:

```sh
cancel.sh --name <name> [--signal TERM|KILL]
```

Semantics:

- If the agent is not currently running, cancellation returns ok:false (no silent no-op).

Flags:

- --name <name>: name of the subagent to cancel (required).
- --signal <sig>: signal to send: TERM (default), KILL.

## Error contract

All commands emit exactly one JSON line.

Common fields:

- ok: boolean
- code: string (stable, machine-readable)
- error: string
- details?: object

## Configuration

| Variable                      | Default            | Description                                                          |
|-------------------------------|--------------------|----------------------------------------------------------------------|
| OPENCODE_PSA_DIR              | .opencode-subagent | Registry directory name.                                             |
| OPENCODE_PSA_MODEL            | (none)             | Default model if --model is omitted.                                 |
| OPENCODE_PSA_VARIANT          | (none)             | Default variant if --variant is omitted.                             |
| OPENCODE_PSA_WAIT_TIMEOUT_SEC | 100                | Max seconds for status --wait and --wait-terminal. 0 = wait forever. |

## TUI Dashboard (Human Use Only)

A terminal dashboard for interactive monitoring. Not part of the orchestrator contract.

```sh
dash.sh [--cwd <dir>] [--refresh <seconds>]
```

- **--cwd <dir>**: Registry root (default: current directory).
- **--refresh <n>**: Poll interval in seconds (default: 2).
- **Dialog navigation**: `j/k` or arrows scroll, `t` toggles tool expansion, `Esc` goes back, `q` quits.

Launch from the skill directory: `scripts/dash.sh` (invokes `dash/opencode-dash.js`). Requires Node.
