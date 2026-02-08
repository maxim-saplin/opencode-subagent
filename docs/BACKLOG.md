# Backlog (opencode-subagent)

Last updated: 2026-02-07

This backlog is derived from code review and manual validation notes.

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
| B-001 | P0 | L | Done | JS migration: single Node CLI + `.sh` wrappers |
| B-002 | P0 | M | Done | Registry v3: atomic mutable file (not JSONL) |
| B-003 | P0 | M | Done | `result`: non-hanging + bounded export timeout |
| B-004 | P0 | S | Done | `run`: JSON error contract for invalid `--cwd` |
| B-005 | P1 | M | Done | `status`: add `--wait-terminal` |
| B-006 | P1 | M | Done | `result`: add `--wait`/`--timeout` |
| B-007 | P1 | S | Done | `cancel`: strict non-running semantics |
| B-008 | P1 | M | Done | SessionId discovery improvements (run + result) |
| B-009 | P2 | M | Done | Error codes (`code`) across all commands |
| B-010 | P2 | M | Done | Update docs for Node/registry/flags |
| B-011 | P2 | S | Done | Doc alignment (v2↔v3 consistency sweep) |
| B-012 | P2 | S | Done | Post-fix manual validation (O04/O07) |
| B-013 | P2 | M | Done | Update/expand deterministic tests for JS migration |
| B-014 | P3 | M | Not started | `status --diagram` ASCII overview |
| B-015 | P3 | L | Not started | Status token/usage reporting (if feasible) |
| B-016 | P2 | M | Done | SessionId gap closure |
| B-017 | P2 | M | Done | Single registry root (no CWD scoping) |

## P0 — Migration (first) + unblock automation

### B-001) JS migration: single Node CLI + `.sh` wrappers

- Status: Done
- Why: Shell + `osascript` is macOS-specific and makes timeouts/JSON brittle.
- Scope:
  - Implement one Node CLI with subcommands: `run`, `status`, `result`, `search`, `cancel`.
  - Keep `.sh` scripts as entrypoints (thin wrappers that call the CLI).
  - Treat Node/npm as a runtime requirement; Bun remains for dev/tests.
- Acceptance:
  - Existing `.sh` entrypoints continue to work with the same flags.
  - Outputs remain one-line JSON for programmatic calls.
  - Non-LLM tests can run using the mock `opencode` shim.

### B-002) Registry v3: atomic mutable file (not JSONL)

- Status: Done
- Why: Append-only JSONL is harder to make race-safe; we want an atomic “latest state” registry.
- Proposed format:
  - `<orchestrator-cwd>/.opencode-subagent/registry.json` containing a map keyed by `name`.
  - Optional: keep a short per-agent history array if needed for debugging.
- Acceptance:
  - Updates are atomic (write temp + rename).
  - Concurrent writers do not corrupt the registry (use lockfile or equivalent).
  - `status` refresh remains deterministic (PID liveness check).

### B-003) `result`: non-hanging + bounded export timeout

- Status: Done
- Why: Blocks O04 and O07; `opencode export` must never hang the orchestrator.
- Acceptance:
  - If `sessionId` missing/empty: fail fast (`ok:false`) and do not attempt export.
  - Export is bounded by timeout; timeout returns `ok:false` with a clear `code`.
  - Deterministic test coverage (mock opencode + synthetic registry states).

### B-004) `run`: JSON error contract for invalid `--cwd`

- Status: Done
- Why: Orchestrators need consistent JSON on early failures.
- Acceptance:
  - Invalid `--cwd` returns one-line JSON error and non-zero exit.
  - Deterministic non-LLM test.

## P1 — Fix test-drive issues (post-migration)

### B-005) `status`: add `--wait-terminal`

- Status: Done
- Why: Current `--wait` returns on any change; orchestration needs “wait until terminal”.
- Acceptance:
  - `--wait` semantics remain unchanged.
  - `--wait-terminal` blocks until `done` or `unknown` for a given `--name`.
  - Documented in `.claude/skills/opencode-subagent/SKILL.md`.

### B-006) `result`: add `--wait`/`--timeout`

- Status: Done
- Why: Orchestrators should be able to “wait then fetch” in one call.
- Acceptance:
  - With `--wait`, wait until terminal then export.
  - Without `--wait`, fail fast if not ready.

### B-007) `cancel`: strict non-running semantics

- Status: Done
- Why: Cancel should not claim success when nothing is running.
- Acceptance:
  - If target is not running, return `ok:false` with a clear `code`.
  - Do not send signals for `done/unknown/scheduled`.
  - Deterministic non-LLM test.

### B-008) SessionId discovery improvements (run + result)

- Status: Done
- Why: Some runs can end up with `sessionId:null`; `result` depends on it.
- Acceptance:
  - `run` attempts discovery and persists `sessionId` when available.
  - `result` can optionally do a brief fallback lookup by title but never blocks/hangs.

## P2 — Finalize + polish

### B-009) Error codes (`code`) across all commands

- Status: Done
- Why: Orchestrators benefit from stable machine-readable reasons.
- Acceptance:
  - Errors include a short `code` (e.g., `E_CWD_INVALID`, `E_SESSIONID_MISSING`, `E_EXPORT_TIMEOUT`).

### B-010) Update docs for Node/registry/flags

- Status: Done
- Scope:
  - `.claude/skills/opencode-subagent/SKILL.md`
  - README usage examples
  - `docs/PROPOSED-CONTRACT.md` (if we treat it as the source of truth)

### B-011) Doc alignment (v2↔v3 consistency sweep)

- Status: Done
- Why: During migration we will temporarily have v2 and v3 docs side-by-side; we need one pass to ensure readers don’t get conflicting instructions.
- Scope:
  - Ensure all docs clearly label whether they apply to v2 vs v3.
  - Ensure all references to registry paths are correct (`runs.jsonl` vs `registry.json`).
  - Ensure examples match the chosen flags and semantics (`--wait-terminal`, `--timeout`, cancel strictness).
  - Ensure the v3 draft in `docs/SKILL-V3-READY.md` matches the intended replacement behavior for `.claude/skills/opencode-subagent/SKILL.md`.
- Acceptance:
  - “Single source of truth” is explicit (either `.claude/skills/opencode-subagent/SKILL.md` or `docs/SKILL-V3-READY.md` during the transition).
  - No doc instructs a command/path combination that can’t work in the targeted version.

### B-012) Post-fix manual validation (O04/O07)

- Status: Done
- Acceptance:
  - Re-run O04 and O07 with a real model and record outcomes.

Notes:
- Rerun on 2026-02-02 with OPENCODE_PSA_MODEL=dial/gpt-5-mini. O04 and O07 were partial/blocked due to missing sessionId in attachments/review runs.

### B-013) Update/expand deterministic tests for JS migration

- Status: Done
- Why: Migration will change the registry format and internals; tests must cover behavior, not implementation details.
- Acceptance:
  - Non-LLM suite passes using mock `opencode`.
  - Add at least one test for concurrent registry updates (or lock behavior).

Notes:
- Added concurrent registry write test in tests/non-llm/registry.spec.ts.

### B-016) SessionId gap closure

- Status: Done
- Why: Some runs still finish without a `sessionId`, blocking result export.
- Scope:
  - Harden discovery retries and ensure terminal records capture stderr/errors.

### B-017) Single registry root (no CWD scoping)

- Status: Done
- Why: Avoid ambiguity when querying across different working directories.
- Scope:
  - Use the orchestrator working directory as the single registry root.
  - Reject duplicate names unless `--resume` is used.

## P3 — Nice-to-have / future ideas

### B-014) `status --diagram` ASCII overview

- Status: Not started
- Notes:
  - Render from cached usage in registry (no export in render path).
  - Include name, status, pid, messageCount, token totals, updatedAt.
  - Support `--watch` to refresh the ASCII view.

### B-015) Status token/usage reporting (if feasible)

- Status: Not started
- Notes:
  - Use a status daemon to run `opencode export` in the background.
  - Cache tokens and message counts for running and done sessions.
  - Embed usage in registry; expose `lastError` and `retryAt`.
