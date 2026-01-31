---
name: opencode-subagent
description: Async-only persistent OpenCode sessions with reliable status tracking via JSONL registry.
compatibility: macOS-focused. Requires opencode CLI and osascript (built-in on macOS).
metadata:
  workflow: orchestration
  kind: subagent
---

Run OpenCode sessions. All runs are async (background). A JSONL registry tracks lifecycle state reliably: `scheduled → running → done`. The orchestrator can introspect and resume 'done' sessions providing new instructions. Prefer for long runnings cmoplex sessnsion OVER default subagents tools, such as 'Task', which are by desgin one-off agent sessions with singular outputs and no way to resume.

## Naming (core semantics)

- `--name` is the stable address of a subagent session. Pick names that encode purpose and scope.
- Suggested grammar: `<area>/<task>/<step>` (examples: `auth/refresh-token/fix`, `payments/refactor/plan`).
- Reusing a name means continuing the same session history (keep `--cwd` stable across runs).

## Agent Session Status

| Status      | Meaning                                                         |
|-------------|-----------------------------------------------------------------|
| `scheduled` | Run record created, process not yet confirmed alive.            |
| `running`   | Process confirmed alive (`kill -0 $pid` succeeds).              |
| `done`      | Process exited; completion record written with `exitCode`.      |
| `unknown`   | PID dead but no completion record (crash, `kill -9`, etc.).     |

## Commands

### run_subagent.sh

Start a named subagent session (always async, returns immediately).

**Usage:**
```
run_subagent.sh --name <name> --prompt <text> [--resume] [--cwd <dir>] \
                [--agent <agent>] [--model <provider/model>] [--file <path> ...]
```

**Output (stdout):** single JSON line.

Success:
```json
{"ok":true,"name":"payments/refactor/plan","pid":12345,"status":"scheduled","sessionId":null,"model":"opencode/gpt-5-nano","mode":"new","startedAt":"2026-01-29T10:00:00Z"}
```

Failure:
```json
{"ok":false,"error":"--prompt is required","details":{"hint":"Provide a non-empty prompt."}}
```

**Flags:**
- `--name <name>`: stable address for this subagent session (required).
- `--prompt <text>`: message sent to the session (required).
- `--resume`: continue the existing session addressed by `--name`.
- `--cwd <dir>`: working directory for `opencode` and registry state (default: `$PWD`).
- `--agent <agent>`: OpenCode agent preset (e.g., `plan`, `build`).
- `--model <provider/model>`: model id (e.g., `opencode/gpt-5-nano`). Falls back to `OPENCODE_PSA_MODEL` env.
- `--file <path>`: attach local file(s) to the message (repeatable).

**Examples:**
```bash
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
  --name "payments/refactor/plan" \
  --prompt "Draft the refactor plan" \
  --model opencode/gpt-5-nano \
  --cwd ".tmp/opencode-psa"

# Resume and continue
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
  --name "payments/refactor/plan" \
  --resume \
  --prompt "Continue: risks + rollout" \
  --cwd ".tmp/opencode-psa"
```

---

### status.sh

Query subagent status (sync list or async wait-for-change).

**Usage:**
```
status.sh [--name <name>] [--cwd <dir>] [--wait] [--timeout <seconds>] [--json]
```

**Output (sync, `--json`):**
```json
{
  "ok": true,
  "agents": [
    {"name":"auth/fix","pid":123,"status":"running","sessionId":"ses_abc","exitCode":null,"startedAt":"...","updatedAt":"...","finishedAt":null},
    {"name":"payments/plan","pid":124,"status":"done","sessionId":"ses_def","exitCode":0,"startedAt":"...","updatedAt":"...","finishedAt":"..."}
  ]
}
```

**Output (wait mode, `--wait --json`):**

Blocks until any agent status changes:
```json
{
  "ok": true,
  "changed": [
    {"name":"auth/fix","previousStatus":"running","status":"done","exitCode":0,"sessionId":"ses_abc","finishedAt":"..."}
  ],
  "agents": [ /* full list */ ]
}
```

**Flags:**
- `--name <name>`: filter to a specific subagent (omit for all).
- `--cwd <dir>`: working directory (default: `$PWD`).
- `--wait`: block until any status changes (long-poll mode).
- `--timeout <sec>`: max seconds to wait in `--wait` mode (default: 300, 0 = forever).
- `--json`: output as JSON (default for programmatic use).

**Examples:**
```bash
# List all agents (sync)
./.claude/skills/opencode-subagent/scripts/status.sh --cwd ".tmp/opencode-psa" --json

# Wait for any completion
./.claude/skills/opencode-subagent/scripts/status.sh --wait --timeout 60 --json --cwd ".tmp/opencode-psa"

# Check specific agent
./.claude/skills/opencode-subagent/scripts/status.sh --name "payments/refactor/plan" --json
```

---

### result.sh

Fetch the last assistant response from a session.

**Usage:**
```
result.sh --name <name> [--cwd <dir>] [--json]
```

**Output (plain text, default):**
```
The refactor plan has three phases...
```

**Output (`--json`):**
```json
{"ok":true,"name":"payments/refactor/plan","sessionId":"ses_abc123","status":"done","lastAssistantText":"The refactor plan has three phases..."}
```

**Flags:**
- `--name <name>`: name of the subagent session (required).
- `--cwd <dir>`: working directory (default: `$PWD`).
- `--json`: output as JSON with metadata.

---

### search.sh

Search session history by regex.

**Usage:**
```
search.sh --name <name> --pattern <regex> [--role any|user|assistant] [--cwd <dir>] [--json]
```

**Output (`--json`):**
```json
{"ok":true,"name":"payments/refactor/plan","sessionId":"ses_abc123","matches":[{"index":2,"role":"assistant","snippet":"...closures are used here..."}]}
```

**Flags:**
- `--name <name>`: name of the subagent session (required).
- `--pattern <regex>`: search pattern (required).
- `--role <role>`: filter by role: `any` (default), `user`, `assistant`.
- `--cwd <dir>`: working directory (default: `$PWD`).
- `--json`: output as JSON.

---

### cancel.sh

Terminate a running subagent.

**Usage:**
```
cancel.sh --name <name> [--cwd <dir>] [--signal <sig>] [--json]
```

**Output:**
```json
{"ok":true,"name":"auth/fix","pid":12345,"signalSent":"TERM","previousStatus":"running"}
```

**Flags:**
- `--name <name>`: name of the subagent to cancel (required).
- `--cwd <dir>`: working directory (default: `$PWD`).
- `--signal <sig>`: signal to send: `TERM` (default), `KILL`.
- `--json`: output as JSON.

---

## Configuration

| Variable              | Default                | Description                              |
|-----------------------|------------------------|------------------------------------------|
| `OPENCODE_PSA_DIR`    | `.opencode-subagent`   | Registry directory name.                 |
| `OPENCODE_PSA_MODEL`  | (none)                 | Default model if `--model` omitted.      |

## Registry

Location: `<cwd>/$OPENCODE_PSA_DIR/runs.jsonl`

Append-only JSONL. Each line is a run record; latest entry per `name` wins.

```jsonc
{"name":"auth/fix","pid":123,"sessionId":"ses_abc","status":"done","exitCode":0,"startedAt":"...","updatedAt":"...","finishedAt":"...","model":"opencode/gpt-5-nano","prompt":"Fix the auth bug","cwd":"/path"}
```

## Platform

macOS only (uses `osascript` for JSON parsing/quoting).
