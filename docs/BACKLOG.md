# Backlog (opencode-subagent)

Last updated: 2026-02-10

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
| B-021 | P1 | M | Done | Refactor skill API: split run_subagent, remove timeout from status/result |
| B-020 | P1 | L | Needs clarification | Improve status_watch table |
| B-019 | P1 | L | Needs clarification | Let the orchestrator choose model variant when kicking of a new session |
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

## B-021

- Split `run_subagent` into `start_subagent` and `resume_subagent`
- Remove `--timeout` from status (use `OPENCODE_PSA_WAIT_TIMEOUT_SEC` env var)
- Remove `--timeout`/`--wait` from result; make result always sync; when running, report status immediately

## B-020

The current table (see below) must have model name and variant (e.g. "gpt-5-low", "gpt-5-medium") tracked in MODEL field, DIALOG field must be renamed to TOKENS

```
LIVE AGENTS
No agents are running.

DONE AGENTS
NAME            STATUS    PID  STARTED              COMPLETED             RUNTIME  MSG  DIALOG  FULL
pipeline/build  done    34812  2026-02-10 15:31:40  2026-02-10 15:34:28  00:02:48    -       -     -
pipeline/plan   done    31287  2026-02-10 15:29:51  2026-02-10 15:31:15  00:01:24    2   10396     -
```

## B-019

While working with open-code I can choose model variants (typically reasoning effort) via ctrl-t, there're predefined variants for standard models, e.g. Low, Medium and High reasoning efforts for GPT-5. Investigate how that is imnplementged and if it can be controlled via CLI, implement is viable.