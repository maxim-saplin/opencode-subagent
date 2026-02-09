# Plan: Status Daemon + Usage/Diagram (B-014, B-015)

This plan defines end-to-end implementation and verification for:
- B-014: `status --diagram` ASCII overview
- B-015: Status token/usage reporting (via background exports)

## Goals
- Provide message counts and dialog token size for all sessions (running and done).
- Keep `status` fast by using cached usage data (eventual consistency).
- Use a background status daemon that starts on demand and exits when no agents are running.
- Embed usage data in the registry (single source of truth).
- Log export exceptions to a local file without surfacing them in standard output.
- Enable a compact ASCII overview via `status --diagram`.

## Decisions and Assumptions
- Usage data is computed from `opencode export` output.
- `dialogTokens` is derived from the latest assistant message `info.tokens.input`.
- `contextFullPct = dialogTokens / contextWindow` when context window size is known; otherwise `null`.
- Usage is eventually consistent; `status` never blocks on export by default.
- The daemon is spawned when needed and exits when no agents are running.
- Registry is the canonical store for cached usage and daemon state.
- For running sessions, usage is partial and updated on a cadence.

## Non-Goals
- No direct reads of OpenCode internal storage files.
- No UI beyond CLI output (ASCII only).
- No breaking changes to existing JSON output fields.

## Data Model (Registry Embedded)
Add a `usage` block and daemon metadata to each agent record in registry.json. Error details are written to a log file and not surfaced in `status` output.

Example shape:
```json
{
  "name": "build/feature-x",
  "status": "running",
  "sessionId": "ses_...",
  "usage": {
    "messageCount": 12,
    "dialogTokens": 1200,
    "contextFullPct": 0.006
  }
}
```

Registry-level daemon state:
```json
{
  "daemon": {
    "pid": 12345,
    "startedAt": "...",
    "lastHeartbeatAt": "..."
  }
}
```

Notes:
- `usage` is omitted until available; no `usage.state` in output.
- Internal retry/backoff fields may exist in the registry but are not surfaced by `status`.
- For `scheduled` agents with no `sessionId`, `usage` remains absent.

## Daemon Lifecycle
- Spawn on demand when any agent is started and no daemon is running.
- Single daemon enforced by a registry lock plus daemon pid check.
- The daemon loops while any agent is `scheduled` or `running`.
- Exit when no agents are in `scheduled` or `running`.

### Trigger Points
- `run` spawns daemon if needed.
- `status --diagram` may also spawn daemon if absent.
- `result` and `search` do not spawn daemon by default.

## Export and Aggregation
- Periodically scan registry for agents with:
  - `sessionId` present, and
  - `status` in `running|done|unknown`, and
  - `usage` missing or stale.
- Staleness rules:
  - Running: update no more than once every N seconds (configurable).
  - Done/Unknown: update if usage is missing or session finished since last export.
- Export pipeline:
  1) `opencode export <sessionId>` with timeout.
  2) Parse `messages` array.
  3) `messageCount = messages.length`.
  4) `dialogTokens = latest assistant info.tokens.input`.
  5) `contextFullPct = dialogTokens / contextWindow` if context window is known.
  6) Write `usage` into registry.

## Error Handling and Retry
- On export failure: log a JSON line to a local log file (see Logging).
- Retry with exponential backoff (cap at max interval).
- Keep retry bookkeeping internal to the registry; do not surface in `status` output.

## Logging (Minimal, Local)
- Log file path: `.opencode-subagent/usage-export.log` (next to `registry.json`).
- Format: JSONL, one line per exceptional event.
- Fields: `time`, `name`, `sessionId`, `error`, `attempt`, `retryAt`.
- Rotation: if file exceeds 1 MB, keep the last 200 lines and truncate.

## `status` Output
- Default JSON includes `usage` when available; otherwise `usage` is absent.
- `status` may trigger the daemon but remains non-blocking.

## `status --diagram`
- ASCII table summarizing name, status, pid, messageCount, dialogTokens, contextFullPct.
- Uses cached `usage` from registry only (no export in render path).
- Optional `--watch <seconds>` to refresh view.

Example layout:
```
NAME                      STATUS   PID     MSG  DIALOG  FULL
build/feature-x           running  12345   12   1200    0.6%
review/feature-x          done     12340   18   1800    0.9%
```

## Work Breakdown Structure (WBS)
1) Registry schema update
  - Add `usage` block (messageCount, dialogTokens, contextFullPct).
  - Add daemon metadata at registry root.
2) Daemon lifecycle
  - Spawn-on-demand in `run` and `status --diagram`.
  - Exit when no agents are `scheduled`/`running`.
  - Single-daemon enforcement via lock + pid check.
3) Export aggregation
  - Export parsing for dialogTokens and messageCount.
  - Context window lookup and contextFullPct computation.
  - Staleness rules for running vs done/unknown.
4) Minimal logging
  - Append JSONL to `.opencode-subagent/usage-export.log`.
  - Rotation/truncation to cap size.
5) Status output
  - Ensure `usage` is included only when available.
  - Keep standard output free of export error details.
6) Diagram output
  - Render ASCII overview from cached usage.
  - Add `--watch` refresh loop.
7) Tests + verification - ADD AND RUN, VEIFY AND FIX!!!
  - Non-LLM deterministic coverage (D01–D06).
  - LLM verification (L11).
  - Manual QA scenario (Scenario 10).

## Test Traceability
- Plan coverage lives in [docs/TEST-AUTOMATION.md](docs/TEST-AUTOMATION.md) and [docs/TEST-CASES-MANUAL.md](docs/TEST-CASES-MANUAL.md).
- WBS mapping to tests:
  - Registry schema + status output → D03, D04, L11.
  - Daemon lifecycle → D01, D02.
  - Export aggregation + contextFullPct → D03, D04, L11.
  - Minimal logging → D05, Scenario 10.
  - Diagram rendering → D06, Scenario 10.

## Testing and Verification
### Automated (Non-LLM)
- Mock export includes assistant `info.tokens` (for dialogTokens).
- New tests:
  - Daemon starts when an agent is launched; registry records daemon pid.
  - Daemon exits when no running agents remain.
  - Running session usage updates on cadence (messageCount and dialogTokens non-zero).
  - Done session usage finalizes after completion.
  - Export failure appends to `usage-export.log` without altering `status` output.
  - `status --diagram` renders expected columns.

### Automated (LLM)
- New LLM test:
  - Run a session with `opencode/gpt-5-nano`.
  - Poll `status` until `usage` is present.
  - Validate `messageCount >= 2` and `dialogTokens > 0`.

### Manual QA (LLM)
- Run a live session; observe `usage` appear in `status` output.
- Open `status --diagram --watch 2` and confirm live updates.
- Simulate an export failure (bad sessionId) and confirm `usage-export.log` records it.

## Delivery Checklist
- Implementation of daemon lifecycle and export loop.
- Registry schema updates and migration path (if needed).
- `status` JSON changes + `status --diagram` output.
- Test updates (non-LLM + LLM + manual QA).
- Documentation updates and backlog status changes.
