# Mock opencode shim

This folder provides a deterministic `opencode` shim for non-LLM tests.

Supported commands:
- `opencode run <prompt> [--title <title>] [--model <provider/model>] [--session <id>] [--file <path>]`
- `opencode session list --format json`
- `opencode export <sessionId>`

Prompt directives:
- `MOCK:REPLY:<TOKEN>` — respond with `<TOKEN>`.
- `MOCK:SLEEP:<SEC>` — sleep `<SEC>` seconds before responding.
- `MOCK:EXIT:<CODE>` — exit with `<CODE>` (no assistant reply).
- `MOCK:ATTACH` — respond with token from attached file (expects `TOKEN: <value>`).

State:
- Use `OPENCODE_MOCK_DIR` to set a test-local state directory. Each session is stored as JSON under `sessions/`.
