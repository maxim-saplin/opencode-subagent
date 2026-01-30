# Manual Orchestrator QA Scenarios

These scenarios are executed by an orchestrator (the QA model) to validate end-to-end behavior. They focus on **real, self-contained tasks** inside this repo and verify that spawned agents perform work and return results.

## Preconditions

- Run from the repo root.
- Ensure the skill scripts are available in this repo.
- Provide a working model via `OPENCODE_PSA_MODEL` (unless you are using a mock `opencode`).
- Use a stable working directory for state, e.g. `.tmp/opencode-psa`.
- Clear prior state when needed: remove `.tmp/opencode-psa/.opencode-subagent/runs.jsonl`.

## Toy Task Catalog (Self-Contained)

These are the prompts and fixtures used across scenarios.

| Task ID | Description | Prompt Template | Expected Result |
|--------|-------------|-----------------|-----------------|
| TT1 | Echo token | `Return EXACT token: <TOKEN>` | Response contains exactly `<TOKEN>` |
| TT2 | File token extraction | Attach `tests/fixtures/attachment-token.txt` and prompt `Return the token after "TOKEN:"` | `PSA_ATTACHMENT_OK` |
| TT3 | Controlled delay (best-effort with live model) | `Wait 5 seconds, then return token: <TOKEN>` | Response after ~5s; contains `<TOKEN>` |
| TT4 | Multi-turn handshake | `Turn 1: reply with ACK-1 only` then resume `Turn 2: reply with ACK-2 only` | `ACK-1`, then `ACK-2` |
| TT5 | Classification | `Respond with exactly one of: CLEAN, SECURITY, PERFORMANCE` | One of the three labels |

## Scenario O01 — Fan-Out / Parallel Execution

**Goal:** Spawn multiple independent tasks, wait for all to complete, aggregate results.

**Steps:**
1. Run three agents in parallel using TT1 with unique tokens: `TOKEN_AUTH`, `TOKEN_PAYMENTS`, `TOKEN_NOTIF`.
2. Poll status until all are `done`.
3. Fetch results and verify each token is present.

**Expected:**
- All three sessions reach `done`.
- Each `result.sh` returns the correct token.

## Scenario O02 — Sequential Pipeline

**Goal:** Execute tasks in sequence where each depends on previous output.

**Steps:**
1. Run `pipeline/plan` with TT1, token `PLAN_OK`.
2. Wait until done and read result.
3. Run `pipeline/review` with prompt: `Review this token and respond with REVIEW_OK if you saw it: <PLAN_OK>`.
4. Wait and verify `REVIEW_OK`.

**Expected:**
- Review only runs after plan completes.
- Review output confirms it saw the plan token.

## Scenario O03 — Iterative Refinement (Multi-Turn Session)

**Goal:** Resume the same named session across multiple turns.

**Steps:**
1. Run `feature/handshake` with TT4 turn 1.
2. Wait, verify `ACK-1`.
3. Resume `feature/handshake` with TT4 turn 2.
4. Wait, verify `ACK-2`.

**Expected:**
- Same `sessionId` across both turns.
- Latest result reflects only the newest turn.

## Scenario O04 — File Attachment Validation

**Goal:** Verify file attachments are passed to the agent and influence output.

**Steps:**
1. Run `files/attachment` with TT2, attaching `tests/fixtures/attachment-token.txt`.
2. Wait and fetch result.

**Expected:**
- Output includes `PSA_ATTACHMENT_OK`.

## Scenario O05 — Supervision + Timeout + Cancel

**Goal:** Demonstrate monitoring and cancellation for long-running tasks.

**Steps:**
1. Run `longrun/timeout` with TT3 token `TIMEBOX_OK`.
2. If still `running` after 2 minutes, call `cancel.sh`.
3. Check status after cancel.

**Expected:**
- If canceled, status becomes `done` or `unknown` and PID is no longer alive.
- If not canceled, result contains `TIMEBOX_OK`.

## Scenario O06 — Conditional Branching

**Goal:** Branch on agent output content.

**Steps:**
1. Run `ci/analyze` with TT5.
2. If `SECURITY`, spawn `ci/security-review` with TT1 token `SECURITY_OK`.
3. If `PERFORMANCE`, spawn `ci/perf-review` with TT1 token `PERF_OK`.
4. If `CLEAN`, skip follow-ups.

**Expected:**
- Only the relevant follow-up agent is spawned.
- Follow-up result contains the expected token.

## Scenario O07 — Scatter-Gather with Synthesis

**Goal:** Split work, gather outputs, then synthesize.

**Steps:**
1. Run `review/readme` with TT1 token `README_OK` (attach README.md).
2. Run `review/changelog` with TT1 token `CHANGELOG_OK` (attach CHANGELOG.md).
3. Wait for both to complete.
4. Run `review/synthesize` with prompt: `Synthesize tokens you saw: <README_OK> and <CHANGELOG_OK>. Reply SYNTH_OK if both present.`

**Expected:**
- Both review agents complete.
- Synthesis returns `SYNTH_OK`.

## Scenario O08 — Checkpoint and Resume Across Orchestrator Sessions

**Goal:** Validate that sessions can be resumed across orchestrator restarts.

**Steps:**
1. Run `research/resume` with TT1 token `RESUME_OK` using `--cwd .tmp/opencode-psa`.
2. End the orchestrator session.
3. Start a new orchestrator session and run `status.sh` with same `--cwd`.
4. Resume `research/resume` with prompt: `Confirm prior token and respond RESUME_CONTINUE_OK`.

**Expected:**
- Status shows existing entry from previous session.
- Resume uses same `sessionId` and returns `RESUME_CONTINUE_OK`.