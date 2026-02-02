# opencode-subagent Skill Test Drive Report

Date: 2026-02-01
Location: repo root
CWD used for runs: `.tmp/opencode-psa`

## Environment

- OS: macOS (osascript/JXA available)
- opencode: 1.1.36 (`/opt/homebrew/bin/opencode`)
- Skill scripts: `.claude/skills/opencode-subagent/scripts/*.sh`
- Model: `opencode/gpt-5-nano` via `OPENCODE_PSA_MODEL`

## Scope

This report validates the skill against `docs/TEST-CASES-MANUAL.md` and records observed behavior, gaps, and actionable improvements for the orchestrator UX and reliability.

## Summary of Findings

What works well:

- Async lifecycle: `run_subagent.sh` schedules background runs and writes JSON immediately.
- Registry: `.opencode-subagent/runs.jsonl` records `scheduled -> running -> done` with timestamps and exit codes.
- Resume: Reusing `--name` with `--resume` continues the same session, preserving `sessionId` where available.
- Concurrency: Multiple sessions can run in parallel without cross-talk.

Issues and surprises:

- `result.sh` can hang on some sessions (notably ones without a discovered `sessionId`), preventing output retrieval for otherwise `done` runs.
- `status.sh --wait` returns on any change, including transient `running -> unknown` blips during worker teardown; this complicates a simple "wait-until-done" usage.
- Error contract inconsistency: invalid `--cwd` in `run_subagent.sh` surfaces a raw shell error instead of JSON.
- `cancel.sh` may report a cancel on already `done` agents (still printing an OK JSON with a signal), which is confusing.

High-leverage improvements:

- Add a reliable wait-until-terminal mode to `status.sh` and document the semantics.
- Make `result.sh` non-blocking when `sessionId` is empty or status is not `done`; optionally add `--wait`.
- Ensure all early failures return one-line JSON with `ok:false` and non-zero exit.
- Record cancel intent and final state, or refuse cancel when not running.

## Manual Test Coverage vs Scenarios (O01 - O08)

Legend: Passed = green check, Partial = triangle, Blocked = stop sign.

1) O01 — Fan-Out / Parallel Execution

- Runs: `o01/auth`, `o01/payments`, `o01/notif` using TT1 prompts.
- Status: All reached `done`.
- Results: `o01/notif` returned `TOKEN_NOTIF`. `o01/auth` and `o01/payments` attempted strict echo but model injected security guidance (refusal to echo what it perceived as a secret token).
- Verdict: Partial. Skill mechanics OK. For strict TT1 validation, use a presence check or rephrase prompt to clarify the string is not a secret.

2) O02 — Sequential Pipeline

- Runs: `pipeline/plan` (TT1 `PLAN_OK`), then `pipeline/review` confirming `PLAN_OK`.
- Status: Both reached `done`.
- Results: `PLAN_OK` then `REVIEW_OK`.
- Verdict: Passed.

3) O03 — Iterative Refinement (Multi-Turn)

- Runs: `feature/handshake` turn 1 (ACK-1), resume turn 2 (ACK-2).
- Status: Same `sessionId` across turns.
- History: `search.sh` confirms both `ACK-1` and `ACK-2` in assistant messages.
- Verdict: Passed.

4) O04 — File Attachment Validation

- Runs: `files/attachment` and `files/attachment2` with `tests/fixtures/attachment-token.txt` (contains `TOKEN: PSA_ATTACHMENT_OK`).
- Status: Both reached `done`.
- Result: `result.sh` timed out when fetching the last assistant text. Likely due to missing `sessionId` for these runs and `opencode export` behavior inside `result.sh`.
- Verdict: Blocked by `result.sh` behavior. The attachment flow likely works (agent completed), but we could not programmatically assert output. See Recommendations.

5) O05 — Supervision + Timeout + Cancel

- Runs: `longrun/timeout` (TT3: 5-second delay then `TIMEBOX_OK`).
- Status: Completed within the timebox; no cancel necessary.
- Result: `TIMEBOX_OK`.
- Verdict: Passed (success path). Cancel path previously exercised during exploratory tests revealed confusing cancel-on-done behavior (see Issues).

6) O06 — Conditional Branching

- Runs: `ci/analyze` (TT5).
- Status: `done`.
- Result: `CLEAN`.
- Verdict: Passed. No follow-ups per spec.

7) O07 — Scatter-Gather with Synthesis

- Runs: `review/readme` and `review/changelog` (TT1 on README.md and CHANGELOG.md), then `review/synthesize` asking for `SYNTH_OK` if both tokens present.
- Status: All `done`.
- Results: `result.sh` hung for `review/readme` and `review/changelog`, so `review/synthesize` reported that neither token was found.
- Verdict: Partial, blocked by `result.sh`. After `result.sh` fix, re-run to confirm `SYNTH_OK`.

8) O08 — Checkpoint and Resume Across Orchestrator Sessions

- Runs: `research/resume` (TT1 `RESUME_OK`), then resume with confirmation (`RESUME_CONTINUE_OK`).
- Status: `done`; same `sessionId` across turns.
- Result: `RESUME_OK` and `RESUME_CONTINUE_OK`.
- Verdict: Passed.

## Reproduction Notes (key commands)

Examples (run from repo root):

```sh
# Use a stable working dir for state
export OPENCODE_PSA_MODEL=opencode/gpt-5-nano
CWDDIR=.tmp/opencode-psa

# O02 pipeline (representative)
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
  --name "pipeline/plan" \
  --prompt "Return EXACT token: PLAN_OK" \
  --cwd "$CWDDIR"

./.claude/skills/opencode-subagent/scripts/status.sh \
  --name "pipeline/plan" --cwd "$CWDDIR" --wait --timeout 120 --json

./.claude/skills/opencode-subagent/scripts/result.sh \
  --name "pipeline/plan" --cwd "$CWDDIR"
```

See `docs/TEST-CASES-MANUAL.md` for the full scenario catalog; all scenarios were executed with analogous commands and captured in the registry at `"$CWDDIR"/.opencode-subagent/runs.jsonl`.

## Detailed Issues and Recommendations

1) `result.sh` can hang and/or fail to retrieve content when `sessionId` is missing

- Observation: For some sessions (e.g., `files/attachment`, `review/readme`), the registry's latest record had `sessionId: null`. `result.sh` then invoked `opencode export "$sid"` with an empty or invalid session id, which hung and caused timeouts.
- Impact: Blocks O04 and O07 validation and generally weakens scriptability for orchestrators.
- Recommended changes (non-breaking):
  - If session status is not `done`, return JSON error early (and optionally support `--wait`).
  - If `sessionId` is empty, attempt a short retry to discover it by `title` (similar to `run_worker.sh`), then fail fast with `ok:false` if still not available.
  - Wrap export in a timeout or handle export errors reliably.

2) `status.sh --wait` exits on any change, including transient `unknown`

- Observation: During the window between process exit and the final `done` record append, `status` may flip to `unknown`. The `--wait` mode reports this change and exits as designed (it waits for any change). For users wanting a "wait until terminal" helper, this is surprising.
- Impact: QA and orchestrator scripts need a loop to poll until terminal states for all targeted sessions.
- Recommended changes:
  - Add `--wait-terminal` (or `--wait-done`) to block until `done` or `unknown` for the targeted name(s).
  - Document current semantics of `--wait` (any change) and the new option.

3) Error contract inconsistency for invalid `--cwd`

- Observation: `run_subagent.sh` prints a raw `cd: ... No such file or directory` error and exits, rather than returning JSON.
- Impact: Orchestrators cannot rely on JSON-only outputs for error handling.
- Recommended change:
  - Guard and JSON-wrap `--cwd` resolution failures with `ok:false` and a non-zero exit code.

4) `cancel.sh` behavior when agent already `done`

- Observation: `cancel.sh` can report a successful signal sent with `previousStatus":"done"`.
- Impact: Confusing to users; suggests a cancel occurred when it was already too late to cancel.
- Recommended changes:
  - Detect non-running state and return `ok:false` with a clear error (or `ok:true` with `no-op:true`), and avoid sending signals.
  - Optionally write a registry record documenting the cancel attempt.

5) Session id discovery gaps (affects result/export)

- Observation: Some runs completed with `sessionId: null` in the registry. `run_worker.sh` does try to discover the id by `title` (up to 20s) and records it in the final `done` record, but this occasionally does not resolve.
- Impact: `result.sh` relies on `sessionId` for `opencode export`. If null, export is unreliable.
- Recommended changes:
  - In `run_worker.sh`, increase or parameterize the discovery window and log when discovery fails.
  - In `result.sh`, implement a fallback discovery by `title` before exporting.

## Model Behavior Considerations (Docs Alignment)

- TT1 strictness: Some prompts like "Return EXACT token: TOKEN_AUTH" can trigger safety behavior in certain models (treating the string as a credential). For stable QA:
  - Prefer a check for the token being present in output rather than exact equality, or
  - Rephrase prompts to clarify: "Return literal string TOKEN_AUTH (this is not a secret)."

## Next Steps

If accepted, implement the following patches and re-run O04 and O07:

1) `result.sh`
   - Fast-fail when not `done`.
   - Fallback discovery of `sessionId` by `title` with short retry.
   - Optional `--wait`.

2) `status.sh`
   - Add `--wait-terminal` to block until `done` or `unknown` for the target(s).

3) `run_subagent.sh`
   - JSON-guard for invalid `--cwd`.

4) `cancel.sh`
   - No-op or error on non-running; record intent if needed.

After these changes, re-run:

- O04 to confirm `PSA_ATTACHMENT_OK` is present in output.
- O07 to confirm `README_OK`, `CHANGELOG_OK`, and `SYNTH_OK`.

## Further considerations
- Context engeneering imporevemements, mak commands leander, e.g don't use absolute paths
```
{"ok":true,"name":"repo/ts-files/list","sessionId":"ses_3ea2dd7ecffehBl4kdOhK2AjMg","status":"done","lastAssistantText":"I searched recursively for TypeScript files and found the following.\n\nWhat I found\n- TypeScript files found: 14\n- No .tsx files detected\n- Location: all under /Users/admin/src/opencode-subagent/tests\n\nList of files\n1) /Users/admin/src/opencode-subagent/tests/non-llm/helpers/wait.ts\n2) /Users/admin/src/opencode-subagent/tests/non-llm/helpers/cleanup.ts\n3) /Users/admin/src/opencode-subagent/tests/non-llm/cancel.spec.ts\n4) /Users/admin/src/opencode-subagent/tests/non-llm/result.spec.ts\n5) /Users/admin/src/opencode-subagent/tests/non-llm/registry.spec.ts\n6) /Users/admin/src/opencode-subagent/tests/non-llm/search.spec.ts\n7) /Users/admin/src/opencode-subagent/tests/non-llm/orchestrator.scenarios.spec.ts\n8) /Users/admin/src/opencode-subagent/tests/llm/cli_stability.spec.ts\n9) /Users/admin/src/opencode-subagent/tests/llm/model_inherit.spec.ts\n10) /Users/admin/src/opencode-subagent/tests/non-llm/status.spec.ts\n11) /Users/admin/src/opencode-subagent/tests/non-llm/helpers/mock-opencode.ts\n12) /Users/admin/src/opencode-subagent/tests/non-llm/run_subagent.spec.ts\n13) /Users/admin/src/opencode-subagent/tests/non-llm/status.basic.spec.ts\n14) /Users/admin/src/opencode-subagent/tests/non-llm/run_subagent.basic.spec.ts\n\nWould you like me to:\n- search within these files for a specific pattern (e.g., interfaces, exports, TODOs),\n- summarize exports or type declarations across them,\n- or run a targeted grep (rg) for a keyword and report matches?"}
```
- Agent status - get number of tokens in session
- Seaparate arg to status script to disaplay ASCII diagram of running agents
- Migrate .sh to js/bun assuming that installing OpenCode requires installing JS (decide, it it is npm or bun, it mps - migrate to mps)

## Appendix: Files Referenced

- Scripts
  - `.claude/skills/opencode-subagent/scripts/run_subagent.sh`
  - `.claude/skills/opencode-subagent/scripts/run_worker.sh`
  - `.claude/skills/opencode-subagent/scripts/status.sh`
  - `.claude/skills/opencode-subagent/scripts/result.sh`
  - `.claude/skills/opencode-subagent/scripts/search.sh`
  - `.claude/skills/opencode-subagent/scripts/cancel.sh`
  - `.claude/skills/opencode-subagent/scripts/registry.sh`

- Docs
  - `docs/TEST-CASES-MANUAL.md`
