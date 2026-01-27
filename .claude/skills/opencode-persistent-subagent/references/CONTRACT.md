# Contract: opencode-persistent-subagent scripts

This skill bundles macOS-focused shell scripts that provide a stable, orchestrator-friendly interface to OpenCode CLI sessions.

## Session identity

- `logicalName`: A stable, human-managed identifier (e.g. `auth-impl`).
- `title`: The OpenCode session title set to `persistent-subagent: <logicalName>`.
- `sessionId`: The opaque OpenCode session id used for resuming via `opencode run --session <sessionId>`.

The scripts maintain an index file (TSV) by default at:

- `.opencode-persistent-subagent/index.tsv` (under the chosen working directory)

It stores one session per line:

```text
<logicalName>\t<sessionId>\t<title>\t<updatedAt>
```

## scripts/run_subagent.sh

Starts or resumes a persistent session.

### Inputs

- `--name <logicalName>` (required)
- `--prompt <text>` (required)
- `--resume` (optional) resume existing `sessionId` for name
- `--agent <agentName>` (optional)
- `--model <provider/model>` (optional)
- `--file <path>` (optional; repeatable)
- `--cwd <dir>` (optional; default current directory)
- `--attach <url>` (optional; passes `--attach` to `opencode run`)
- `--async` (optional; return after session becomes discoverable)
- `--title-prefix <text>` (optional; default `persistent-subagent: `)

### Output (stdout)

Always prints a single JSON object on stdout (one line):

```json
{
  "ok": true,
  "name": "auth-impl",
  "title": "persistent-subagent: auth-impl",
  "sessionId": "...",
  "mode": "new|resume",
  "async": false,
  "lastAssistantText": "...",
  "exportAvailable": true
}
```

Notes:

- `exportAvailable` is best-effort; it is `false` if `opencode export` failed or produced no parsable output.
- `lastAssistantText` is best-effort; it may be `null`.

When invoked with `--async`, output includes a `pid` field and will not attempt export:

```json
{
  "ok": true,
  "name": "auth-impl",
  "title": "persistent-subagent: auth-impl",
  "sessionId": "...",
  "mode": "new|resume",
  "async": true,
  "pid": 12345,
  "lastAssistantText": null,
  "exportAvailable": false
}
```

On failure:

```json
{ "ok": false, "error": "...", "details": {"hint": "..."} }
```

## scripts/extract_last.sh

Prints the last assistant message for a session.

### Inputs

- `--name <logicalName>` or `--session <sessionId>` (one required)
- `--json` (optional) emit structured JSON

### Output

- Default: plain text (last assistant message)
- With `--json`: `{ "ok": true, "sessionId": "...", "lastAssistantText": "..." }` (`lastAssistantText` may be `null`)

## scripts/search_history.sh

Searches exported messages for a regex.

### Inputs

- `--name <logicalName>` or `--session <sessionId>` (one required)
- `--pattern <regex>` (required)
- `--role <user|assistant|any>` (optional)
- `--json` (optional)

### Output

- Default: one match per line: `[#<i> <role>] <snippet>`
- With `--json`: `{ "ok": true, "sessionId": "...", "matches": [ ... ] }`

## Configuration knobs

- Index location can be overridden with environment variables:
  - `INDEX_DIR` (default: `.opencode-persistent-subagent`)
  - `INDEX_FILE` (default: `index.tsv`)
- Title prefix can be overridden per call via `--title-prefix` (default: `persistent-subagent: `)
