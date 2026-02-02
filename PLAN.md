# Plan: JS-first Migration + Hardening (opencode-subagent)

Date: 2026-02-02

This plan is based on:
- The manual test-drive report in `docs/TEST-DRIVE-REPORT-2026-02-01.md`.
- The current v2 skill contract in `.claude/skills/opencode-subagent/SKILL.md`.
- The existing script + test suite behavior (non-LLM tests use `tests/mock-opencode/opencode`).

## Direction / decisions

We will address the macOS/zsh fragility by migrating the implementation to JavaScript while keeping the external UX stable.

- Runtime: Node.js (installed via npm). Treat Node/npm as a requirement, similar to the `opencode` CLI.
- Dev/test: keep Bun as a dev dependency for running the existing test suite.
- Entry points: keep the existing `.sh` scripts as the public interface.
- Implementation: a single JS CLI that implements `run/status/result/search/cancel`.
- Registry: switch from append-only JSONL (`runs.jsonl`) to a **mutable registry file** with **atomic writes**.

## Problem statement

The core lifecycle (async runs + JSONL registry) works, but orchestrator automation is currently blocked by a few reliability gaps:

1) `result.sh` can hang when `sessionId` is missing (registry record has `sessionId: null`), because it calls `opencode export` with an empty ID.
2) `status.sh --wait` returns on *any* status change (including transient `running → unknown`), which is correct per current contract but not ideal for the common “wait until terminal” orchestration need.
3) Some early failures (notably invalid `--cwd`) can surface as raw shell errors rather than a single JSON error line.
4) `cancel.sh` can report a successful cancel even when the agent is already `done`, which is confusing.
5) `run_worker.sh` currently captures exit codes incorrectly (it uses `wait ... || true; EXIT_CODE=$?`, which typically records `0`). This undermines the registry contract.

## Goals

- JS-based CLI eliminates macOS-only dependencies (`osascript`) and makes JSON + timeouts reliable.
- `.sh` entrypoints remain stable for orchestrators.
- Registry updates are atomic and race-resistant.
- Unblock the test-drive failures (O04/O07) and make the skill operational.

## Non-goals (for this iteration)

- Building a full orchestrator UI.
- Token-accurate usage accounting unless OpenCode exposes usage metadata reliably.

## Work breakdown

### Phase 1 — JS migration (foundation)

1) Implement a single Node CLI
- Provide one executable entry (e.g., `opencode-subagent`) with subcommands:
  - `run`, `status`, `result`, `search`, `cancel`
- Parse args (keep flags compatible with existing `.sh` scripts).
- Standardize JSON output and error shapes.

2) Keep `.sh` entry points as wrappers
- Each script (`run_subagent.sh`, `status.sh`, `result.sh`, `search.sh`, `cancel.sh`) becomes a thin wrapper that:
  - validates minimal environment (e.g., Node exists)
  - calls the JS CLI with equivalent args

3) Replace JSONL registry with an atomic mutable registry
- Replace `<cwd>/.opencode-subagent/runs.jsonl` with `<cwd>/.opencode-subagent/registry.json` (exact name TBD).
- Store a map by agent `name` (latest state only) + optional history metadata.
- Write updates via atomic rename (`write tmp → fsync → rename`) to avoid partial writes.
- Add a simple lock to prevent lost updates under concurrency (lockfile with `O_EXCL`, or an in-process queue if single writer).

Acceptance criteria:
- Existing non-LLM tests can be adapted to the new implementation without losing determinism.
- Concurrency does not corrupt the registry file.

### Phase 2 — Fix test-drive issues in the JS implementation

4) `result` is safe and non-hanging
- If `sessionId` missing, fail fast.
- `opencode export` always has a bounded timeout.
- Optional `--wait/--timeout` implemented on the JS side.

5) Add “wait until terminal” status mode
- Keep current “wait for any change” behavior.
- Add `--wait-terminal` (or `--wait-done`) to wait until `done` or `unknown` for a named agent.

6) Fix cancel semantics
- If not running, return a clear error (preferred for orchestration) or a documented no-op contract (pick one and lock it).

7) Ensure correct exit codes
- Registry `exitCode` reflects the real `opencode run` exit code.

### Phase 3 — Finalize skill as operational

8) Update docs
- Update `.claude/skills/opencode-subagent/SKILL.md` and README to describe:
  - Node/npm requirement
  - registry file format and location
  - new flags (`--wait-terminal`, `--timeout`) and semantics
  - Use 'docs/SKILL-V3-READY.md' as source for the change

9) Validate against manual scenarios
- Re-run O04 and O07 with a real model and record outcomes.

## Test strategy

### Non-LLM suite (must stay deterministic)

Add or extend tests to cover:
- `result.sh` behavior when the registry record exists but `sessionId` is `null` (must fail fast and not export).
- `run_subagent.sh` invalid `--cwd` returns JSON error.
- `cancel.sh` on `done` returns the chosen “no-op” or error shape.
- `status.sh --wait-terminal` behavior.

These can be implemented without depending on real OpenCode behavior by manipulating the registry file and using the mock `opencode` shim.

### LLM suite (optional but recommended)

Add a small, high-signal scenario test that recreates O04/O07 using real `opencode` + a configured `OPENCODE_PSA_MODEL`, verifying:
- Attachment token extraction works end-to-end.
- Scatter-gather synthesis becomes reliable once `result.sh` is fixed.

## Rollout

- Land JS CLI + wrapper scripts first (keeps interface stable).
- Then address the reliability gaps inside the JS implementation.
- Update docs and re-run O04/O07 to confirm the skill is “operational and done”.

## Risks and mitigations

- Registry write races: implement a lock + atomic rename; add a concurrency test.
- Backward compatibility: keep `.sh` flags stable; wrappers should translate args 1:1.
- OpenCode CLI behavior drift: keep export parsing tolerant; keep LLM CLI stability checks.
