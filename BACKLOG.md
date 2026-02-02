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
| B-001 | P0 | L | Not started | JS migration: single Node CLI + `.sh` wrappers |
| B-002 | P0 | M | Not started | Registry v3: atomic mutable file (not JSONL) |
| B-003 | P0 | M | Not started | `result`: non-hanging + bounded export timeout |
| B-004 | P0 | S | Not started | `run`: JSON error contract for invalid `--cwd` |
| B-005 | P1 | M | Not started | `status`: add `--wait-terminal` |
| B-006 | P1 | M | Not started | `result`: add `--wait`/`--timeout` |
| B-007 | P1 | S | Not started | `cancel`: strict non-running semantics |
| B-008 | P1 | M | Not started | SessionId discovery improvements (run + result) |
| B-009 | P2 | M | Not started | Error codes (`code`) across all commands |
| B-010 | P2 | M | Not started | Update docs for Node/registry/flags |
| B-011 | P2 | S | Not started | Doc alignment (v2↔v3 consistency sweep) |
| B-012 | P2 | S | Not started | Post-fix manual validation (O04/O07) |
| B-013 | P2 | M | Not started | Update/expand deterministic tests for JS migration |
| B-014 | P3 | M | Needs clarification | `status --diagram` ASCII overview |
| B-015 | P3 | L | Needs clarification | Status token/usage reporting (if feasible) |

## P0 — Migration (first) + unblock automation

### B-001) JS migration: single Node CLI + `.sh` wrappers

- Status: Not started
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

- Status: Not started
- Why: Append-only JSONL is harder to make race-safe; we want an atomic “latest state” registry.
- Proposed format:
  - `<cwd>/.opencode-subagent/registry.json` containing a map keyed by `name`.
  - Optional: keep a short per-agent history array if needed for debugging.
- Acceptance:
  - Updates are atomic (write temp + rename).
  - Concurrent writers do not corrupt the registry (use lockfile or equivalent).
  - `status` refresh remains deterministic (PID liveness check).

### B-003) `result`: non-hanging + bounded export timeout

- Status: Not started
- Why: Blocks O04 and O07; `opencode export` must never hang the orchestrator.
- Acceptance:
  - If `sessionId` missing/empty: fail fast (`ok:false`) and do not attempt export.
  - Export is bounded by timeout; timeout returns `ok:false` with a clear `code`.
  - Deterministic test coverage (mock opencode + synthetic registry states).

### B-004) `run`: JSON error contract for invalid `--cwd`

- Status: Not started
- Why: Orchestrators need consistent JSON on early failures.
- Acceptance:
  - Invalid `--cwd` returns one-line JSON error and non-zero exit.
  - Deterministic non-LLM test.

## P1 — Fix test-drive issues (post-migration)

### B-005) `status`: add `--wait-terminal`

- Status: Not started
- Why: Current `--wait` returns on any change; orchestration needs “wait until terminal”.
- Acceptance:
  - `--wait` semantics remain unchanged.
  - `--wait-terminal` blocks until `done` or `unknown` for a given `--name`.
  - Documented in `.claude/skills/opencode-subagent/SKILL.md`.

### B-006) `result`: add `--wait`/`--timeout`

- Status: Not started
- Why: Orchestrators should be able to “wait then fetch” in one call.
- Acceptance:
  - With `--wait`, wait until terminal then export.
  - Without `--wait`, fail fast if not ready.

### B-007) `cancel`: strict non-running semantics

- Status: Not started
- Why: Cancel should not claim success when nothing is running.
- Acceptance:
  - If target is not running, return `ok:false` with a clear `code`.
  - Do not send signals for `done/unknown/scheduled`.
  - Deterministic non-LLM test.

### B-008) SessionId discovery improvements (run + result)

- Status: Not started
- Why: Some runs can end up with `sessionId:null`; `result` depends on it.
- Acceptance:
  - `run` attempts discovery and persists `sessionId` when available.
  - `result` can optionally do a brief fallback lookup by title but never blocks/hangs.

## P2 — Finalize + polish

### B-009) Error codes (`code`) across all commands

- Status: Not started
- Why: Orchestrators benefit from stable machine-readable reasons.
- Acceptance:
  - Errors include a short `code` (e.g., `E_CWD_INVALID`, `E_SESSIONID_MISSING`, `E_EXPORT_TIMEOUT`).

### B-010) Update docs for Node/registry/flags

- Status: Not started
- Scope:
  - `.claude/skills/opencode-subagent/SKILL.md`
  - README usage examples
  - `docs/PROPOSED-CONTRACT.md` (if we treat it as the source of truth)

### B-011) Doc alignment (v2↔v3 consistency sweep)

- Status: Not started
- Why: During migration we will temporarily have v2 and v3 docs side-by-side; we need one pass to ensure readers don’t get conflicting instructions.
- Scope:
  - Ensure all docs clearly label whether they apply to v2 vs v3.
  - Ensure all references to registry paths are correct (`runs.jsonl` vs `registry.json`).
  - Ensure examples match the chosen flags and semantics (`--wait-terminal`, `--timeout`, cancel strictness).
  - Ensure the v3 draft in `docs/SKILL-V3.md` matches the intended replacement behavior for `.claude/skills/opencode-subagent/SKILL.md`.
- Acceptance:
  - “Single source of truth” is explicit (either `.claude/skills/opencode-subagent/SKILL.md` or `docs/SKILL-V3.md` during the transition).
  - No doc instructs a command/path combination that can’t work in the targeted version.

### B-012) Post-fix manual validation (O04/O07)

- Status: Not started
- Acceptance:
  - Re-run O04 and O07 with a real model and record outcomes.

### B-013) Update/expand deterministic tests for JS migration

- Status: Not started
- Why: Migration will change the registry format and internals; tests must cover behavior, not implementation details.
- Acceptance:
  - Non-LLM suite passes using mock `opencode`.
  - Add at least one test for concurrent registry updates (or lock behavior).

## P3 — Nice-to-have / future ideas

### B-014) `status --diagram` ASCII overview

- Status: Needs clarification
- Notes:
  - Provide a compact view of names, states, PIDs, and updatedAt.

### B-015) Status token/usage reporting (if feasible)

- Status: Needs clarification
- Notes:
  - Only do this if OpenCode export includes stable usage metadata; otherwise provide approximate counts (word/char) and label them clearly.

## Further considerations (needs clarification)

These are follow-on ideas from the test-drive report that are valuable, but need a decision before they become actionable backlog items.

1) Node requirement and installation guidance
- Decision: Node/npm is required at runtime; Bun is dev-only.
- Remaining question: do we want to add a preflight check in wrappers that prints a friendlier error if `node` is missing?

2) “Wait until terminal” semantics
- Question: When `--name` is omitted, should `--wait-terminal` return when **any** agent reaches terminal, or only when **all** agents are terminal?
- Recommendation: require `--name` for `--wait-terminal` (keep behavior unambiguous) and add a separate flag if we want “all”.

3) Cancel API contract
- Decision: strict error when target is not running.
- Remaining question: do we want an explicit `--no-op-ok` flag for idempotent “cancel everything” scripts?

4) Session ID discovery responsibility
- Question: should `result` attempt a fallback lookup by title if `sessionId` is missing, or should it strictly require the registry to have the ID?
- Recommendation: allow a brief fallback lookup but keep it bounded and optional.

5) Reduce absolute paths in outputs/prompts
- Question: Should scripts avoid printing absolute paths in JSON (e.g., omit `cwd` or store it but not print it), or is this only a prompt-engineering recommendation for manual tests?

6) Token/usage reporting feasibility (affects B-015)
- Question: Which exact “usage” metric is desired: tokens (prompt/completion/total), characters, or messages?
- Constraint: Only implement tokens if `opencode export` exposes stable usage metadata.

7) `status.sh --diagram` desired format (affects B-014)
- Question: Should the diagram be purely ASCII table, a timeline-like diagram, or a tree view?
- Decision needed: columns/fields (name, status, pid, sessionId, updatedAt, exitCode).

5) Registry file format
- Question: Do we need to preserve any historical run records (debugging/audit), or is “latest per name” sufficient?
- Recommendation: store latest per name + optionally a small ring buffer history per name.
