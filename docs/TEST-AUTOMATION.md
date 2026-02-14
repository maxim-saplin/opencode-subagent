# Test Automation Plan

This document is the single source of truth for automated test coverage and expectations.
Manual QA scenarios live in docs/TEST-CASES-MANUAL.md.

## Model Configuration (LLM Suite)

- Environment variable: OPENCODE_PSA_MODEL
- Default (documented): opencode/gpt-5-nano
- If missing or invalid, LLM suite must be skipped with a clear message.

## Non-LLM Suite (Deterministic)

Purpose: deterministic validation of scripts and orchestrator behavior using a mock opencode shim in PATH.

### Mock opencode Contract

The automation harness provides an opencode shim that supports:

- opencode run <prompt> ...
- opencode session list --format json
- opencode export <sessionId>

#### Prompt Grammar (suggested)

| Pattern | Behavior |
|---------|----------|
| MOCK:REPLY:<TOKEN> | Respond with <TOKEN> immediately. |
| MOCK:SLEEP:<SEC> | Sleep <SEC> seconds before completing. |
| MOCK:EXIT:<CODE> | Exit with <CODE> without producing a response. |
| MOCK:ATTACH | Echo token from attached file (expects tests/fixtures/attachment-token.txt). |

### Coverage

#### 1) Script Contract Tests (Unit)

- start_subagent.sh / resume_subagent.sh: required flags, JSON error contract, resume by name, file attachments, registry write.
- status.sh: minimal agent records, wait and wait-terminal semantics, usage fields when available.
- result.sh: plain text default, --json metadata, sync-only (returns status when running).
- search.sh: JSON output with matches and role filtering.
- cancel.sh: strict non-running semantics and JSON error contract.
- Registry mechanics: atomic updates, dedupe by name, concurrent writes.

#### 2) End-to-End Orchestrator Scenarios (Deterministic)

Use mock prompts for predictable timing and outcomes:

- A01: Single agent lifecycle (MOCK:SLEEP:5)
- A02: Fan-out + first completion (MOCK:SLEEP:1 and MOCK:SLEEP:5)
- A03: Resume same session (MOCK:REPLY:ACK-1 then ACK-2)
- A04: Cancel long-running task (MOCK:SLEEP:30)
- A05: File attachment echo (MOCK:ATTACH)
- A06: Failure and retry (MOCK:EXIT:1 then MOCK:REPLY:RECOVERED)
- A07: Concurrency cap (10 tasks, max 3 concurrent)
- A08: Orchestrator restart (--cwd .tmp/opencode-psa)

#### 3) Status Daemon + Usage Cache (Deterministic)

- D01: Daemon spawns when first agent starts; registry records daemon pid.
- D02: Daemon exits after no agents are scheduled/running.
- D03: Running session shows usage with message count and dialogTokens.
- D04: Done session usage finalizes and remains stable.
- D05: Export failure appends a JSON line to .opencode-subagent/usage-export.log.
- D06: status --diagram renders cached usage without blocking.

#### 4) TUI Dashboard (Non-LLM)

Deterministic tests for the dash TUI using a mock DataProvider; no live opencode required.

- **Data:** `tests/non-llm/tui.data.spec.ts` — registry parsing, child extraction, token/formatter helpers.
- **Render:** `tests/non-llm/tui.render.spec.tsx` — Dashboard/AgentDialog/ChildrenPanel output with ink-testing-library.
- **Navigation:** `tests/non-llm/tui.navigation.spec.tsx` — screen transitions, keybindings, selection.
- **Crawl:** `tests/non-llm/tui.crawl.spec.tsx` — deterministic screen-graph crawl at constrained terminal sizes (dashboard → children → dialog → back).

## LLM-Dependent Suite

Purpose: validate real OpenCode CLI behavior + real model execution, while keeping the set small and high-signal.

### 1) Script Feature Verification (LLM)

- L01: start_subagent.sh -> status.sh -> result.sh basic lifecycle.
- L02: resume_subagent.sh keeps same sessionId and appends history.
- L03: --file attachment influences output (tests/fixtures/attachment-token.txt).
- L04: search.sh finds content from multiple turns.

### 2) End-to-End Scenarios (LLM)

- L05: Fan-out (3 agents) completes and returns tokens.
- L06: Sequential pipeline (plan -> review) preserves ordering.
- L07: Cancel long-running task and observe done or unknown.
- L11: status shows usage with dialogTokens and messageCount.

### 3) OpenCode CLI Stability Checks (LLM)

- L08: opencode session list --format json returns parseable JSON and includes id/sessionId, title, and created/updated fields.
- L09: opencode export <sessionId> returns a JSON object with a messages array and includes model metadata under info.model or equivalent.
- L10: opencode run creates a discoverable session ID within a reasonable timeout (session list poll succeeds).

## Fixtures

- tests/fixtures/attachment-token.txt
