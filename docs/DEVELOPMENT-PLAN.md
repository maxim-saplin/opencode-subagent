# Development Plan — Async-Only Subagent Skill

This plan derives from:
- Spec: docs/PROPOSED-CONTRACT.md
- Skill doc: docs/SKILL-v2.md
- Automation tests: docs/TEST-AUTOMATION.md
- Manual QA: docs/TEST-CASES-MANUAL.md

## 1) Current Standing (Gap Summary)

**What exists today**
- Async + sync behavior in `run_subagent.sh` (sync uses model inheritance + export).
- TSV index/log persistence, title-based session discovery.
- No `status.sh`, `result.sh`, `search.sh`, `cancel.sh` in v2 contract.
- Legacy PID runner `opencode-subagent.sh` (RUNNING/ENDED only).

**Key gaps vs spec**
- Must be async-only and registry-driven (JSONL) with explicit `scheduled/running/done/unknown`.
- Need status tool supporting sync list and async wait.
- Need deterministic end-to-end behavior for non-LLM tests via mock `opencode`.
- Need OpenCode CLI stability checks for upstream regressions.

## 2) Design Decisions (Confirm / Lock)

1. **Skill replacement (Step 0)**: Replace the older skill with SKILL-v2 in-place at `/.claude/skills/opencode-subagent/` so the project uses v2 semantics by default.
2. **Registry**: JSONL at `<cwd>/.opencode-subagent/runs.jsonl` (append-only; latest per name wins).
3. **Runner wrapper**: A background worker writes `running` and `done` records reliably on exit.
4. **Model config**: `OPENCODE_PSA_MODEL` default documented as `opencode/gpt-5-nano`.

## 3) TDD-Oriented Phases

### Step 0 — Replace Skill Definition (Required First Step)

**Goal:** Ensure SKILL-v2 semantics are the active contract.

Deliverables:
- Replace existing skill definition at `/.claude/skills/opencode-subagent/SKILL.md` with the content of `docs/SKILL-v2.md` (or equivalently update to match v2).
- Keep legacy scripts intact until tests guide new implementation.

Acceptance:
- `SKILL.md` reflects async-only, JSONL registry, and v2 commands.

### Phase A — Tests First (Non-LLM + Automation Harness)

**Goal:** Establish test scaffolding and deterministic checks before implementation.

Deliverables:
- Mock `opencode` shim executable in tests (e.g., `tests/mock-opencode/opencode`).
- Fixtures for export/session JSON and attachment token.
- Non-LLM test suite skeletons covering:
  - Script feature tests (R/S/E/H/C cases).
  - Registry mechanics (M cases).
  - Deterministic orchestrator scenarios (A cases).

Acceptance:
- Non-LLM suite runs end-to-end (expected failures until implementation).

### Phase B — Implement Core Library & Registry

**Goal:** Build shared utilities to satisfy failing tests.

Deliverables:
- Shared `lib.sh` utilities:
  - JSONL append with atomic write (temp file + rename).
  - Read/dedupe by `name` (latest wins).
  - Status refresh (PID liveness).
  - Time helpers (ISO timestamps).
  - JSON quoting (osascript).
- Registry schema enforcement and compatibility notes.

Acceptance:
- Registry utilities satisfy M01–M04 deterministically.

### Phase C — Implement Script Set (v2)

**Goal:** Implement async-only contract in scripts to satisfy failing tests.

Deliverables:
- `run_subagent.sh` (async-only):
  - Validates flags.
  - Writes `scheduled` to registry.
  - Spawns wrapper; returns JSON (one line).
- `status.sh`: sync list + `--wait` long-polling.
- `result.sh`: export last assistant text.
- `search.sh`: regex search by role.
- `cancel.sh`: terminate PID and report.
- Wrapper worker (e.g., `run_worker.sh`) to write `running` and `done` records and capture `exitCode`.

Acceptance:
- All R/S/E/H/C tests in docs/TEST-AUTOMATION.md (non-LLM suite) pass with mock `opencode`.

### Phase D — Non-LLM Suite Green

**Goal:** Ensure all deterministic tests pass before enabling LLM tests.

Deliverables:
- Non-LLM suite green:
  - Script feature tests (R/S/E/H/C).
  - Registry mechanics (M).
  - Orchestrator scenarios (A).

Acceptance:
- Non-LLM suite passes reliably in CI.

### Phase E — LLM-Dependent Suite

**Goal:** Validate real OpenCode CLI behavior and model execution.

Deliverables:
- LLM tests gated by `OPENCODE_PSA_MODEL`.
- End-to-end cases L01–L07 (script features + scenarios).
- CLI stability checks L08–L10.

Acceptance:
- LLM suite passes with model `opencode/gpt-5-nano` (or configured model).
- Failures produce clear skip or diagnostic messages.

### Phase F — Docs & Migration

**Goal:** Keep docs aligned and minimize breaking changes.

Deliverables:
- Update README with v2 usage and environment variables.
- Add migration notes from TSV index/log to JSONL registry.
- Mark legacy `opencode-subagent.sh` as deprecated (no changes required).

Acceptance:
- docs/SKILL-v2.md matches implementation details.
- docs/TEST-AUTOMATION.md and docs/TEST-CASES-MANUAL.md match actual behavior.

## 4) Execution Order (TDD)

0. Replace SKILL-v2 in-place (Step 0).
1. Build mock `opencode` + non-LLM test scaffolds (Phase A).
2. Implement registry utilities to satisfy M tests (Phase B).
3. Implement scripts to satisfy R/S/E/H/C/A tests (Phase C).
4. Ensure Non-LLM suite green (Phase D).
5. Add LLM suite + CLI stability checks (Phase E).
6. Docs updates and cleanup (Phase F).

## 5) Risk & Mitigations

- **Race conditions in async discovery** → Wrapper writes `done` status and sessionId on exit.
- **Upstream CLI schema changes** → L08–L10 CLI stability checks.
- **Flaky LLM output** → Keep LLM suite minimal; prefer deterministic tests.

## 6) Exit Criteria

- Non-LLM suite fully green (script features + deterministic scenarios).
- LLM suite green or skipped with explicit reason.
- Manual QA scenarios in docs/TEST-CASES-MANUAL.md reproducible.
- v2 scripts and registry aligned with docs/PROPOSED-CONTRACT.md and docs/SKILL-v2.md.
