# Test Automation Plan (LLM vs Non-LLM)

Note: The current test suite targets the v2 `.sh` scripts. Under v3, the `.sh` scripts remain as wrappers while the implementation moves to a single Node CLI. This document will be updated as the v3 implementation lands; see docs/SKILL-V3-READY.md for the draft contract.

This document defines the automation test split and coverage. The plan is **LLM-dependent** vs **non-LLM** for practicality and repeatability.

## Model Configuration (LLM Suite)

- Environment variable: `OPENCODE_PSA_MODEL`
- Default (documented): `opencode/gpt-5-nano`
- If missing or invalid, LLM suite **must be skipped** with a clear message.

## Non-LLM Suite (Deterministic)

Purpose: deterministic validation of scripts and orchestrator behavior using a mock `opencode` shim in `PATH`.

### Mock `opencode` Contract

The automation harness should provide an `opencode` shim that supports:

- `opencode run <prompt> ...` — records a session and exits after a deterministic delay.
- `opencode session list --format json` — returns deterministic session metadata.
- `opencode export <sessionId>` — returns deterministic messages for the session.

#### Prompt Grammar (suggested)

| Pattern | Behavior |
|---------|----------|
| `MOCK:REPLY:<TOKEN>` | Respond with `<TOKEN>` immediately. |
| `MOCK:SLEEP:<SEC>` | Sleep `<SEC>` seconds before completing. |
| `MOCK:EXIT:<CODE>` | Exit with `<CODE>` without producing a response. |
| `MOCK:ATTACH` | Echo token from attached file (expects `tests/fixtures/attachment-token.txt`). |

### Non-LLM Coverage

#### 1) Script Feature Tests (Unit)

These are the CLI contract tests for individual scripts (same IDs as before):

- `run_subagent.sh`: R01–R10
- `status.sh`: S01–S10
- `result.sh`: E01–E04
- `search.sh`: H01–H05
- `cancel.sh`: C01–C05
- Registry mechanics: M01–M04

#### 2) End-to-End Orchestrator Scenarios (Deterministic)

Use mock prompts for predictable timing and outcomes:

- A01: Single agent lifecycle (`MOCK:SLEEP:5`)
- A02: Fan-out + first completion (`MOCK:SLEEP:1` and `MOCK:SLEEP:5`)
- A03: Resume same session (`MOCK:REPLY:ACK-1` then `ACK-2`)
- A04: Cancel long-running task (`MOCK:SLEEP:30`)
- A05: File attachment echo (`MOCK:ATTACH`)
- A06: Failure and retry (`MOCK:EXIT:1` → `MOCK:REPLY:RECOVERED`)
- A07: Concurrency cap (10 tasks, max 3 concurrent)
- A08: Orchestrator restart (`--cwd .tmp/opencode-psa`)

## LLM-Dependent Suite

Purpose: validate real OpenCode CLI behavior + real model execution, while keeping the set small and high-signal.

### 1) Script Feature Verification (LLM)

- L01: `run_subagent.sh` → `status.sh` → `result.sh` basic lifecycle
- L02: `--resume` keeps same `sessionId` and appends history
- L03: `--file` attachment influences output (uses `tests/fixtures/attachment-token.txt`)
- L04: `search.sh` finds content from multiple turns

### 2) End-to-End Scenarios (LLM)

- L05: Fan-out (3 agents) completes and returns tokens
- L06: Sequential pipeline (plan → review) preserves ordering
- L07: Cancel long-running task and observe `done` or `unknown`

### 3) OpenCode CLI Stability Checks (LLM)

These ensure upstream CLI changes don’t break the scripts:

- L08: `opencode session list --format json` returns parseable JSON and includes `id/sessionId`, `title`, and `created/updated` fields.
- L09: `opencode export <sessionId>` returns a JSON object with a `messages` array and includes model metadata under `info.model` or equivalent.
- L10: `opencode run` creates a discoverable session ID within a reasonable timeout (session list poll succeeds).

## Fixtures

- `tests/fixtures/attachment-token.txt` — used by attachment tests.