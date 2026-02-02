# Backlog (opencode-subagent)

Last updated: 2026-02-02

This backlog is derived from `docs/TEST-DRIVE-REPORT-2026-02-01.md` plus code review of the v2 scripts and tests.

Conventions:
- **Priority**: P0 (blocking), P1 (high), P2 (medium), P3 (nice-to-have).
- **Effort**: S (≤0.5d), M (0.5–2d), L (2–5d).
- **Status**:
  - Not started
  - In progress
  - Blocked
  - Done
  - Needs clarification

## Index

| ID | Pri | Eff | Status | Title |
|---:|:---:|:---:|:-------|:------|
| B-001 | P0 | S | Not started | Fix `run_worker.sh` exit code capture |
| B-002 | P0 | M | Not started | Make `result.sh` non-hanging when `sessionId` missing |
| B-003 | P0 | M | Needs clarification | Add bounded export execution in `result.sh` |
| B-004 | P0 | S | Not started | Guard invalid `--cwd` in `run_subagent.sh` |
| B-005 | P1 | M | Needs clarification | Add `status.sh --wait-terminal` (or `--wait-done`) |
| B-006 | P1 | M | Needs clarification | Add `result.sh --wait --timeout` |
| B-007 | P1 | M | Not started | Add sessionId fallback discovery inside `result.sh` |
| B-008 | P1 | S | Needs clarification | Improve `cancel.sh` semantics for non-running targets |
| B-009 | P2 | S | Not started | Parameterize session discovery window in `run_worker.sh` |
| B-010 | P2 | M | Not started | Add structured error codes in JSON errors |
| B-011 | P2 | S | Not started | Update docs for new flags/semantics |
| B-012 | P2 | S | Not started | Post-fix manual validation (O04/O07) |
| B-013 | P3 | L | Needs clarification | Status token/usage reporting (if feasible) |
| B-014 | P3 | M | Needs clarification | `status.sh --diagram` ASCII overview |
| B-015 | P3 | L | Needs clarification | Migrate scripts to JS/Bun |

## P0 — Unblock orchestrator automation

### B-001) Fix `run_worker.sh` exit code capture

- Status: Not started
- Why: Registry `exitCode` is unreliable due to `wait ... || true` usage.
- Acceptance:
  - Registry `exitCode` matches actual `opencode run` exit code.
  - Add a deterministic non-LLM test that simulates a non-zero exit and asserts recorded `exitCode`.

### B-002) Make `result.sh` non-hanging when `sessionId` is missing

- Status: Not started
- Why: Blocks O04 and O07; calling `opencode export` with an empty ID can hang.
- Acceptance:
  - If `sessionId` is null/empty: return `ok:false` quickly (no export attempt).
  - Add a non-LLM test that writes a `done` record with `sessionId:null` and verifies the failure is fast.

### B-003) Add bounded export execution in `result.sh`

- Status: Needs clarification
- Why: Even valid exports should not be allowed to hang an orchestrator.
- Acceptance:
  - Export is wrapped in a timeout.
  - Timeout produces `ok:false` with an actionable error.

### B-004) Guard invalid `--cwd` in `run_subagent.sh`

- Status: Not started
- Why: Raw `cd: ...` errors break JSON-only orchestration.
- Acceptance:
  - Invalid `--cwd` returns one-line JSON error and non-zero exit.
  - Add a deterministic non-LLM test.

## P1 — Improve orchestration UX (additive flags)

### B-005) Add `status.sh --wait-terminal` (or `--wait-done`)

- Status: Needs clarification
- Why: Current `--wait` waits for *any change*, which is not the common “wait until done” need.
- Acceptance:
  - New flag blocks until terminal (`done`/`unknown`) for the target name.
  - Existing `--wait` behavior remains unchanged.
  - Update `.claude/skills/opencode-subagent/SKILL.md` documentation.

### B-006) Add `result.sh --wait --timeout`

- Status: Needs clarification
- Why: Lets orchestrators do a single call to “wait then fetch output”.
- Acceptance:
  - With `--wait`, `result.sh` waits for terminal status then exports.
  - Without `--wait`, behavior stays fast and safe.

### B-007) Add sessionId fallback discovery inside `result.sh`

- Status: Not started
- Why: Some `done` runs still end up with `sessionId:null`; allow best-effort recovery.
- Acceptance:
  - If `sessionId` is missing, attempt to find by title via `opencode session list` for a short window.
  - If still missing, fail with a clear JSON error.

### B-008) Improve `cancel.sh` semantics for non-running targets

- Status: Needs clarification
- Why: “cancel succeeded” when already `done` is misleading.
- Acceptance:
  - If status is `done/unknown/scheduled` (or PID not alive), return a clear error or `noOp:true`.
  - Add a deterministic non-LLM test covering cancel-on-done.

## P2 — Quality and diagnostics

### B-009) Parameterize session discovery window in `run_worker.sh`

- Status: Not started
- Why: Make “session id discovery gaps” tunable without code edits.
- Acceptance:
  - Env var like `OPENCODE_PSA_SESSION_DISCOVERY_TIMEOUT_SEC` controls the poll loop.

### B-010) Structured error codes in JSON errors

- Status: Not started
- Why: Orchestrators benefit from stable machine-readable reasons.
- Acceptance:
  - Errors include a short `code` (e.g., `E_CWD_INVALID`, `E_SESSIONID_MISSING`, `E_EXPORT_TIMEOUT`).

### B-011) Update docs to reflect new flags + semantics

- Status: Not started
- Scope:
  - `.claude/skills/opencode-subagent/SKILL.md`
  - README usage examples
  - `docs/PROPOSED-CONTRACT.md` (if we treat it as the source of truth)

### B-012) Post-fix manual validation

- Status: Not started
- Acceptance:
  - Re-run O04 and O07 with a real model and record outcomes.

## P3 — Nice-to-have / future ideas

### B-013) Status token/usage reporting (if feasible)

- Status: Needs clarification
- Notes:
  - Only do this if OpenCode export includes stable usage metadata; otherwise provide approximate counts (word/char) and label them clearly.

### B-014) `status.sh --diagram` ASCII overview

- Status: Needs clarification
- Notes:
  - Provide a compact view of names, states, PIDs, and updatedAt.

### B-015) Migrate scripts to JS/Bun

- Status: Needs clarification
- Notes:
  - Requires a decision on runtime dependency (Node vs Bun) and a compatibility plan for macOS + CI.

## Further considerations (needs clarification)

These are follow-on ideas from the test-drive report that are valuable, but need a decision before they become actionable backlog items.

1) Timeout implementation approach (affects B-003)
- Question: Is it acceptable to depend on `python3` (macOS default) to implement a portable timeout wrapper, or must this remain pure POSIX shell + built-ins?
- Decision needed: Timeout duration default and override flag (`--timeout` seconds).

2) “Wait until terminal” semantics (affects B-005)
- Question: When `--name` is omitted, should `--wait-terminal` return when **any** agent reaches terminal, or only when **all** agents are terminal?
- Recommendation: For orchestration, prefer `--name` required for `--wait-terminal`, or define two modes: `--wait-terminal` (any) and `--wait-all-terminal` (all).

3) Cancel API contract (affects B-008)
- Question: For canceling `done/unknown/scheduled`, do we want:
  - strict error (`ok:false`, non-zero exit), or
  - “no-op success” (`ok:true`, `noOp:true`)?
- Recommendation: strict error for orchestration, optional `--force` or `--no-op-ok` if you want idempotency.

4) Session ID discovery responsibility (affects B-007)
- Question: Is calling `opencode session list` from `result.sh` acceptable (best-effort), or should result strictly rely on what `run_worker.sh` recorded?
- Recommendation: keep result safe + best-effort discovery, but never block/hang.

5) Reduce absolute paths in outputs/prompts
- Question: Should scripts avoid printing absolute paths in JSON (e.g., omit `cwd` or store it but not print it), or is this only a prompt-engineering recommendation for manual tests?

6) Token/usage reporting feasibility (affects B-013)
- Question: Which exact “usage” metric is desired: tokens (prompt/completion/total), characters, or messages?
- Constraint: Only implement tokens if `opencode export` exposes stable usage metadata.

7) `status.sh --diagram` desired format (affects B-014)
- Question: Should the diagram be purely ASCII table, a timeline-like diagram, or a tree view?
- Decision needed: columns/fields (name, status, pid, sessionId, updatedAt, exitCode).

8) JS/Bun migration decision (affects B-015)
- Question: If migrating off shell, should the runtime be Node (ubiquitous) or Bun (already used for tests)?
- Decision needed: distribution method (scripts in repo vs installable package) and platform support (macOS-only vs cross-platform).
