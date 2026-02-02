# Reliability Hardening Plan (opencode-subagent)

Date: 2026-02-01

This plan is based on:
- The manual test-drive report in `docs/TEST-DRIVE-REPORT-2026-02-01.md`.
- The current v2 skill contract in `.claude/skills/opencode-subagent/SKILL.md`.
- The existing script + test suite behavior (non-LLM tests use `tests/mock-opencode/opencode`).

## Problem statement

The core lifecycle (async runs + JSONL registry) works, but orchestrator automation is currently blocked by a few reliability gaps:

1) `result.sh` can hang when `sessionId` is missing (registry record has `sessionId: null`), because it calls `opencode export` with an empty ID.
2) `status.sh --wait` returns on *any* status change (including transient `running → unknown`), which is correct per current contract but not ideal for the common “wait until terminal” orchestration need.
3) Some early failures (notably invalid `--cwd`) can surface as raw shell errors rather than a single JSON error line.
4) `cancel.sh` can report a successful cancel even when the agent is already `done`, which is confusing.
5) `run_worker.sh` currently captures exit codes incorrectly (it uses `wait ... || true; EXIT_CODE=$?`, which typically records `0`). This undermines the registry contract.

## Goals (v2.x hardening)

- `result.sh` is **non-hanging** and returns a single-line JSON error on all failure modes.
- Add a **wait-until-terminal** mode to `status.sh` while preserving existing `--wait` semantics.
- All scripts return **one-line JSON** (`ok:false`) on argument/IO errors, including invalid `--cwd`.
- `cancel.sh` clearly communicates whether it actually canceled something.
- Registry `exitCode` is accurate and trustworthy.
- Unblock manual scenarios O04 and O07 (attachment validation and scatter-gather synthesis).

## Non-goals (for this iteration)

- Full migration from shell scripts to JS/Bun.
- Building a full orchestrator UI.
- Token-accurate usage accounting unless OpenCode exposes usage metadata reliably.

## Proposed changes (by script)

### 1) `result.sh` (highest priority)

Changes:
- Fast-fail if the resolved record is missing or if `sessionId` is empty/null.
- Fast-fail when status is not terminal unless an explicit wait flag is used.
- Add `--wait` (and `--timeout`) to optionally block until the target becomes `done` (or terminal), then attempt export.
- Add a bounded export execution (timeout wrapper) so `opencode export` cannot hang indefinitely.
- Add a best-effort fallback to discover `sessionId` by session title (same title used by `run_subagent.sh` / `run_worker.sh`), then proceed if found.

Acceptance criteria:
- `result.sh --name X --json` never blocks indefinitely.
- When `sessionId` is missing, output is JSON: `{ ok:false, error:"SessionId not available" ... }` and a non-zero exit.
- O04/O07 become automatable again.

### 2) `status.sh`

Changes:
- Keep existing `--wait` semantics (“return on any change”).
- Add `--wait-terminal` (name TBD, e.g. `--wait-done`) to block until:
  - for a specific `--name`: status is `done` or `unknown`.
  - for no `--name`: all agents are terminal (or optionally: return when any becomes terminal).
- Document the semantics clearly in `.claude/skills/opencode-subagent/SKILL.md`.

Acceptance criteria:
- Orchestrators can do: `status.sh --name X --wait-terminal --timeout 120 --json` and get a stable end-state.

### 3) `run_subagent.sh`

Changes:
- Guard `--cwd` resolution so invalid directories return a one-line JSON error (`ok:false`) instead of raw `cd` output.

Acceptance criteria:
- Invalid `--cwd` is handled consistently across scripts.

### 4) `cancel.sh`

Changes:
- If the latest status is not `running` (or if PID is missing/dead), return either:
  - `ok:false` with a clear message (preferred for orchestration), or
  - `ok:true` with `noOp:true` and `reason:"not running"`.
- Do not send signals for `done`/`unknown` entries.

Acceptance criteria:
- Canceling a completed agent does not claim a successful cancellation.

### 5) `run_worker.sh`

Changes:
- Fix exit code capture so registry `exitCode` reflects the actual `opencode run` exit status.
- Make session id discovery configurable (env var, default stays ~20s) and record when discovery fails.
- Ensure the final `done` record includes the discovered `sessionId` when available.

Acceptance criteria:
- Registry `exitCode` is accurate across success/failure.
- `sessionId:null` in `done` becomes rare and diagnosable.

## Test strategy

### Non-LLM suite (must stay deterministic)

Add or extend tests to cover:
- `result.sh` behavior when the registry record exists but `sessionId` is `null` (must fail fast and not export).
- `run_subagent.sh` invalid `--cwd` returns JSON error.
- `cancel.sh` on `done` returns the chosen “no-op” or error shape.
- `status.sh --wait-terminal` behavior.

These can be implemented without depending on real OpenCode behavior by directly writing `runs.jsonl` records and using the mock `opencode` shim.

### LLM suite (optional but recommended)

Add a small, high-signal scenario test that recreates O04/O07 using real `opencode` + a configured `OPENCODE_PSA_MODEL`, verifying:
- Attachment token extraction works end-to-end.
- Scatter-gather synthesis becomes reliable once `result.sh` is fixed.

## Rollout

- Implement changes behind additive flags where possible (`--wait-terminal`, `--wait`, `--timeout`).
- Update `.claude/skills/opencode-subagent/SKILL.md` with new semantics.
- Re-run manual scenarios O04 and O07 and append a short “post-fix validation” note to the test-drive report.

## Risks and mitigations

- macOS availability of `timeout`: avoid depending on GNU `timeout`; implement a portable timeout wrapper (e.g., Python-based or `perl alarm`).
- OpenCode CLI export behavior may change: keep parsing tolerant and add LLM CLI stability checks if new flags are introduced.
- Session discovery is inherently best-effort: `result.sh` must remain safe even when discovery fails.
