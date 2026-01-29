---
name: opencode-subagent
description: Persistent OpenCode sessions addressed by names, managed via bundled scripts with JSON stdout.
compatibility: macOS-focused. Requires opencode CLI and osascript (built-in on macOS).
metadata:
  workflow: orchestration
  kind: persistence
---

# opencode-subagent

Run persistent OpenCode sessions that are addressed by a meaningful `--name`. The scripts manage OpenCode `sessionId` internally and expose a stable JSON interface on stdout.

## Naming (core semantics)

- `--name` is the stable address of a subagent session. Pick names that encode purpose and scope.
- Suggested grammar: `<area>/<task>/<step>` (examples: `auth/refresh-token/fix`, `payments/refactor/plan`).
- Reusing a name means continuing the same session history (make `--cwd` stable across runs).

## Commands

### run_subagent.sh

Start or resume a named session.

Usage:
`run_subagent.sh --name <name> --prompt <text> [--resume] [--cwd <dir>] [--agent <agent>] [--model <provider/model>] [--file <path> ...] [--async] [--title-prefix <text>]`

Output (stdout): always one JSON object (one line).

Success (sync):

```json
{"ok":true,"name":"...","title":"persistent-subagent: ...","sessionId":"ses_...","mode":"new|resume","async":false,"modelUsed":"opencode/gpt-5-nano","attempts":1,"exportAvailable":true,"lastAssistantText":"..."}
```

Success (async):

```json
{"ok":true,"name":"...","title":"...","sessionId":"ses_..." ,"mode":"new|resume","async":true,"pid":12345,"modelUsed":"opencode/gpt-5-nano","attempts":1,"exportAvailable":false,"lastAssistantText":null}
```

Failure:

```json
{"ok":false,"error":"...","details":{"hint":"...","attempts":2}}
```

Notes:
- `sessionId` is informational; orchestrators address sessions by `name`.
- If `--model` is omitted, the script tries to reuse a model already present in the orchestrator dialog (best-effort, max 2 attempts). If it can’t run, it asks for an explicit `--model provider/model`.
- `--attach` attaches to a running OpenCode server (e.g. `http://localhost:4096`); it does not attach arbitrary URLs as context.

Flags:
- `--name <name>`: stable address for this subagent session (core organizational unit).
- `--prompt <text>`: message sent to the session.
- `--resume`: continue the existing session addressed by `--name`.
- `--cwd <dir>`: working directory for `opencode` and where the scripts persist name->session mapping state.
- `--agent <agent>`: OpenCode agent preset to run the prompt under (e.g. `plan`, `build`).
- `--model <provider/model>`: model id in OpenCode provder/model format (e.g. `opencode/gpt-5-nano`). If omitted, scripts attempt to reuse an existing model from the orchestrator dialog.
- `--file <path>`: attach local file(s) to the message (repeatable).
- `--async`: run in background and return once the session is discoverable; does not export last answer.
- `--title-prefix <text>`: override the title prefix (default `persistent-subagent: `).

Examples:

```bash
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
  --name "payments/refactor/plan" \
  --prompt "Draft the refactor plan" \
  --cwd ".tmp/opencode-psa"

./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
  --name "payments/refactor/plan" \
  --resume \
  --prompt "Continue: risks + rollout" \
  --cwd ".tmp/opencode-psa"
```

### extract_last.sh

Usage:
`extract_last.sh --name <name> [--cwd <dir>] [--json]`

Output:
- default: plain text (last assistant message)
- `--json`: `{ "ok": true, "sessionId": "ses_...", "lastAssistantText": "..." }`

### search_history.sh

Usage:
`search_history.sh --name <name> --pattern <regex> [--role any|user|assistant] [--cwd <dir>] [--json]`

Output:
- default: `[#<i> <role>] <snippet>`
- `--json`: `{ "ok": true, "sessionId": "ses_...", "matches": [ ... ] }`

## Configuration

- `INDEX_DIR` default `.opencode-subagent`
- `LOG_FILE` default `log.tsv`
- `INDEX_FILE` default `index.tsv` (legacy)
- `OPENCODE_PSA_MODEL` optional `provider/model` default

## Platform

macOS only (uses `osascript` for JSON parsing/quoting).
