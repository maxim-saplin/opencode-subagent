# Test Cases

Split into non-LLM (CLI behavior) and LLM-dependent (requires a working model).

## Non-LLM
- New session JSON shape: one-line JSON; fields include `ok`, `name`, `title`, `mode`, `async`, `exportAvailable`.
- Resume by name: `--resume --name <x>` resolves via log/index; no session id required by caller.
- Error messaging: missing `--prompt`, unknown flags → `ok:false` + actionable hints.
- Async mode: includes `pid`, `async:true`, no export attempt.
- Attach semantics: `--attach` to running server; attaching arbitrary URLs should error with a clear hint.
- Append-only log: multiple writes produce unique rows; latest entry per name wins when resolving.

## LLM-dependent
- Inherit model: no `--model` → uses parent model; returns `modelUsed`, `attempts=1`.
- Dialog-derived fallback: break the first inherited model; next historical model succeeds; `attempts=2`.
- Extract last: text returns latest assistant message; `--json` includes `sessionId` and `lastAssistantText`.
- History search: matches include indices and roles; `--json` returns an array of matches.
- File attachment: export shows file part; response includes known token from attached file.

## Skips / Gating
- LLM tests run only if a known working model is available (e.g., env `OPENCODE_PSA_MODEL`).
- Non-LLM tests run always.
