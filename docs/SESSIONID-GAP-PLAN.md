# SessionId Gap Plan

Date: 2026-02-06

Backlog linkage: B-016 in docs/BACKLOG.md

## Goal

Close the gap where runs end with `sessionId: null`, which blocks `result` and attachment/review validation.

## Observed Symptoms

- `status --wait-terminal` returns `unknown` for some attachment/review runs.
- `result` returns `E_SESSIONID_MISSING` for those runs.
- `opencode session list --format json` can include log lines before JSON, causing parse failures.

## Root Cause (likely)

- Session discovery relies on parsing `opencode session list` output by title.
- When CLI emits log lines before JSON, parsing fails and discovery returns empty.
- That leaves registry entries without `sessionId`.

## Fix Plan

1) Make session list parsing tolerant of leading logs
- Extract the first complete JSON value from stdout before parsing.
- This is already implemented for export parsing; reuse the same helper.

2) Extend discovery windows where needed
- `run` worker: keep 40 attempts (20s), but allow override via env (e.g., `OPENCODE_PSA_DISCOVERY_SECONDS`).
- `result`: keep a short fallback by title; allow override via env (e.g., `OPENCODE_PSA_RESULT_DISCOVERY_SECONDS`).

3) Add directory match fallback
- When title match fails, optionally match sessions whose `directory` matches the run `cwd` and whose `title` includes the subagent name.
- Keep this fallback opt-in (env flag) to avoid accidental cross-project matches.

4) Improve diagnostics
- When discovery fails, include a brief `details` payload in the JSON error:
  - `details.attempts`
  - `details.cwd`
  - `details.title`
  - `details.lastSessionListSnippet` (truncated)

## Verification

- Re-run O04 and O07 with `OPENCODE_PSA_MODEL=dial/gpt-5-mini` and confirm:
  - `status --wait-terminal` reaches `done`.
  - `result --wait` returns the attachment/review tokens without `E_SESSIONID_MISSING`.

## Out of Scope

- Global registry redesign.
- Usage reporting.
- Status diagram output.
