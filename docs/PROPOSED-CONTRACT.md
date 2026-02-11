# Proposed Contract: Async-Only Subagent Orchestration (Legacy)

Note: This document describes the legacy shell/JXA implementation (JSONL registry).
The current contract (Node-based single CLI + atomic mutable registry) is documented in .claude/skills/opencode-subagent/SKILL.md.

This document specifies the revised script interface for managing persistent OpenCode subagent sessions with reliable status tracking.

---

## Design Principles

1. **Async-only execution**: All runs are background processes; no blocking "sync" mode.
2. **Persistent run registry**: A file-based registry tracks all runs with their lifecycle state.
3. **Deterministic status**: Status is derived from registry + PID liveness, not title-based session discovery.
4. **Atomic state transitions**: Registry writes are atomic (rename) to avoid corruption.

---

## Status Model

| Status      | Meaning                                                                 |
|-------------|-------------------------------------------------------------------------|
| `scheduled` | Run record created, process not yet confirmed alive.                    |
| `running`   | Process confirmed alive (`kill -0 $pid` succeeds).                      |
| `done`      | Process exited; runner wrote completion record with `exitCode`.         |
| `unknown`   | PID no longer alive but no completion record exists (crash/kill -9).    |

Transitions:
```
scheduled → running → done
scheduled → unknown (if process dies before confirmation)
running   → unknown (if process dies without completion write)
```

---

## Registry Format

Location: `<cwd>/.opencode-subagent/runs.jsonl`

Each line is a JSON object (append-only, latest entry per `name` wins):

```jsonc
{
  "name": "auth/refresh-token/fix",
  "pid": 12345,
  "sessionId": "ses_abc123",        // null until discovered
  "status": "scheduled",            // scheduled | running | done | unknown
  "exitCode": null,                 // integer when done
  "startedAt": "2026-01-29T10:00:00Z",
  "updatedAt": "2026-01-29T10:00:00Z",
  "finishedAt": null,               // ISO timestamp when done
  "model": "opencode/gpt-5-nano",   // model used (may be null if not yet known)
  "prompt": "Draft the refactor plan",
  "cwd": "/Users/admin/src/project"
}
```

---

## Scripts

The orchestration system consists of the following scripts:

- `start_subagent.sh`: Start a new named subagent session asynchronously.
- `resume_subagent.sh`: Continue an existing session addressed by name.
- `status.sh`: Query or wait for subagent status changes.
- `result.sh`: Fetch the last assistant response from a session.
- `search.sh`: Search session history by regex.
- `cancel.sh`: Terminate a running subagent.

### 1. `start_subagent.sh` / `resume_subagent.sh`

Start a new session (`start_subagent.sh`) or continue an existing session (`resume_subagent.sh`). Always async.

**Usage (start):**
```
start_subagent.sh --name <name> --prompt <text> [--cwd <dir>] \
                  [--agent <agent>] [--model <provider/model>] [--file <path> ...]
```

**Usage (resume):**
```
resume_subagent.sh --name <name> --prompt <text> [--cwd <dir>]
```

**Flags:**
| Flag                | Required | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `--name <name>`     | Yes      | Stable address for this subagent session.                |
| `--prompt <text>`   | Yes      | Message sent to the session.                             |
| `--cwd <dir>`       | No       | Working directory (default: `$PWD`).                     |
| `--agent <agent>`   | No       | OpenCode agent preset (e.g., `plan`, `build`).           |
| `--model <p/m>`     | No       | Model in `provider/model` format.                        |
| `--file <path>`     | No       | Attach file(s) to the message (repeatable).              |

**Output (stdout, single JSON line):**

Success:
```json
{
  "ok": true,
  "name": "auth/refresh-token/fix",
  "pid": 12345,
  "status": "scheduled",
  "sessionId": null,
  "model": "opencode/gpt-5-nano",
  "mode": "new",
  "startedAt": "2026-01-29T10:00:00Z"
}
```

Failure:
```json
{
  "ok": false,
  "error": "--prompt is required",
  "details": { "hint": "Provide a non-empty prompt." }
}
```

**Behavior:**
1. Validate inputs.
2. For resume, resolve existing `sessionId` from registry.
3. Write `scheduled` record to registry.
4. Spawn `opencode run` in background via wrapper that will:
   - Update registry to `running` once process starts.
   - Update registry to `done` with `exitCode` and `sessionId` on exit.
5. Return immediately with `scheduled` status.

---

### 2. `status.sh`

Query or wait for subagent status changes.

**Usage:**
```
status.sh [--name <name>] [--cwd <dir>] [--wait] [--wait-terminal]
```

Timeout for wait modes: `OPENCODE_PSA_WAIT_TIMEOUT_SEC` env (default: 100, 0 = forever).

**Flags:**
| Flag                | Required | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `--name <name>`     | No       | Filter to specific subagent (omit for all).              |
| `--cwd <dir>`       | No       | Working directory (default: `$PWD`).                     |
| `--wait`            | No       | Block until any status changes (long-poll mode).         |
| `--wait-terminal`   | No       | Wait until target --name reaches done or unknown.        |

**Output (sync mode):**
```json
{
  "ok": true,
  "agents": [
    {
      "name": "auth/refresh-token/fix",
      "pid": 12345,
      "status": "running",
      "exitCode": null,
      "startedAt": "2026-01-29T10:00:00Z",
      "updatedAt": "2026-01-29T10:00:05Z",
      "finishedAt": null
    },
    {
      "name": "payments/refactor/plan",
      "pid": 12346,
      "status": "done",
      "exitCode": 0,
      "startedAt": "2026-01-29T09:55:00Z",
      "updatedAt": "2026-01-29T10:02:00Z",
      "finishedAt": "2026-01-29T10:02:00Z"
    }
  ]
}
```

**Output (wait mode, `--wait`):**

Returns when any agent's status changes:
```json
{
  "ok": true,
  "changed": [
    {
      "name": "auth/refresh-token/fix",
      "previousStatus": "running",
      "status": "done",
      "exitCode": 0,
      "finishedAt": "2026-01-29T10:05:00Z"
    }
  ],
  "agents": [ /* full list */ ]
}
```

**Behavior:**
1. Read registry, dedupe by name (latest entry wins).
2. For each entry, refresh `status`:
   - If `scheduled` or `running`: check `kill -0 $pid`.
   - If PID dead and no `done` record: mark `unknown`.
3. Sync mode: return immediately.
4. Wait mode: poll registry + PID liveness every 0.5s until change or timeout.

---

### 3. `result.sh`

Fetch the last assistant response from a completed (or running) session.

**Usage:**
```
result.sh --name <name> [--cwd <dir>] [--json]
```

**Flags:**
| Flag                | Required | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `--name <name>`     | Yes      | Name of the subagent session.                            |
| `--cwd <dir>`       | No       | Working directory (default: `$PWD`).                     |
| `--json`            | No       | Output as JSON with metadata.                            |

**Output (plain text, default):**
```
The refactor plan has three phases...
```

**Output (`--json`):**
```json
{
  "ok": true,
  "name": "auth/refresh-token/fix",
  "sessionId": "ses_abc123",
  "status": "done",
  "lastAssistantText": "The refactor plan has three phases..."
}
```

**Behavior:**
1. Resolve `sessionId` from registry by name.
2. Run `opencode export $sessionId`.
3. Extract last assistant message text.

---

### 4. `search.sh`

Search session history by regex.

**Usage:**
```
search.sh --name <name> --pattern <regex> [--role any|user|assistant] [--cwd <dir>]
```

**Output:**
```json
{
  "ok": true,
  "name": "auth/refresh-token/fix",
  "matches": [
    { "index": 2, "role": "assistant", "snippet": "...closures are used here..." }
  ]
}
```

---

### 5. `cancel.sh`

Terminate a running subagent.

**Usage:**
```
cancel.sh --name <name> [--cwd <dir>] [--signal <sig>]
```

**Flags:**
| Flag                | Required | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `--name <name>`     | Yes      | Name of the subagent to cancel.                          |
| `--cwd <dir>`       | No       | Working directory (default: `$PWD`).                     |
| `--signal <sig>`    | No       | Signal to send (default: `TERM`, options: `KILL`).       |

**Output:**
```json
{
  "ok": true,
  "name": "auth/refresh-token/fix",
  "pid": 12345,
  "signalSent": "TERM",
  "previousStatus": "running"
}
```

**Behavior:**
1. Resolve PID from registry.
2. Send signal.
3. Registry will be updated to `done` or `unknown` by the wrapper or next status poll.

---

## Internal: Wrapper Script

The `start_subagent.sh` / `resume_subagent.sh` spawns a wrapper that:

1. Writes `running` status to registry once `opencode run` is confirmed started.
2. Polls `opencode session list` to discover `sessionId` (with timeout).
3. On process exit: writes `done` with `exitCode`, `finishedAt`, and final `sessionId`.

This ensures `done` is reliably recorded even if the orchestrator doesn't poll.

---

## Error Handling

All scripts emit `{"ok":false,"error":"...","details":{...}}` on failure.

Common errors:
| Error                          | Hint                                                    |
|--------------------------------|---------------------------------------------------------|
| `--name is required`           | Provide a stable name for the subagent.                 |
| `--prompt is required`         | Provide a non-empty prompt.                             |
| `No session found for name`    | Start a session first or check --cwd matches.           |
| `Model not available`          | Provide --model or set OPENCODE_PSA_MODEL.              |
| `Agent not running`            | Cannot cancel; agent already finished.                  |

---

## Environment Variables

| Variable              | Description                                      |
|-----------------------|--------------------------------------------------|
| `OPENCODE_PSA_MODEL`  | Default model if `--model` is omitted.           |
| `OPENCODE_PSA_DIR`    | Override registry directory (default `.opencode-subagent`). |

---
