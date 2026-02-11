# Backlog (opencode-subagent)

Last updated: 2026-02-11

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

## TBD (not refined notes)

## Index

| ID | Pri | Eff | Status | Title |
|---:|:---:|:---:|:-------|:------|
| B-022 | P1 | M | Not started | Status/usage reporting issues: FULL, DIALOG_TKN while running, model on resume |
| B-021 | P1 | M | Done | Refactor skill API: split run_subagent, remove timeout from status/result |
| B-020 | P1 | M | Done | Improve status_watch table: add MODEL column, rename DIALOG → DIALOG_TKN |
| B-019 | P1 | M | Done | Pass `--variant` (reasoning effort) through to opencode CLI |
| B-018 | P1 | L | Needs clarification | [Context Management] Dialog cleanup script, drop older tool details by using an LLM to decide on summarizing certain tools and filling in with compressed detail |
| B-001 | P0 | L | Done | JS migration: single Node CLI + `.sh` wrappers |
| B-002 | P0 | M | Done | Registry: atomic mutable file (not JSONL) |
| B-003 | P0 | M | Done | `result`: non-hanging + bounded export timeout |
| B-004 | P0 | S | Done | `run`: JSON error contract for invalid `--cwd` |
| B-005 | P1 | M | Done | `status`: add `--wait-terminal` |
| B-006 | P1 | M | Done | `result`: add `--wait`/`--timeout` |
| B-007 | P1 | S | Done | `cancel`: strict non-running semantics |
| B-008 | P1 | M | Done | SessionId discovery improvements (run + result) |
| B-009 | P2 | M | Done | Error codes (`code`) across all commands |
| B-010 | P2 | M | Done | Update docs for Node/registry/flags |
| B-011 | P2 | S | Done | Doc alignment (legacy↔current consistency sweep) |
| B-012 | P2 | S | Done | Post-fix manual validation (O04/O07) |
| B-013 | P2 | M | Done | Update/expand deterministic tests for JS migration |
| B-014 | P3 | M | Done | `status --diagram` ASCII overview |
| B-015 | P3 | L | Done | Status token/usage reporting (if feasible) |
| B-016 | P2 | M | Done | SessionId gap closure |
| B-017 | P2 | M | Done | Single registry root (no CWD scoping) |