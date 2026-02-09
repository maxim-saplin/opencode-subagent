# AGENTS

## Core Layout
- CLI: .claude/skills/opencode-subagent/bin/opencode-subagent.js
- Wrappers: .claude/skills/opencode-subagent/scripts/*.sh (no logic)
- Registry: <orchestrator-cwd>/.opencode-subagent/registry.json (atomic, lockfile)
- Daemon log: .opencode-subagent/usage-export.log
- Mock CLI: tests/mock-opencode/opencode

## Version Rule
- Make sure to sync version in package.json and CHANGELOG
- Contract version = major of package.json version (e.g. 4.0.0 is v4);

## Non-Negotiables
- Async-only behavior; exports are always timeout-bounded.
- Registry writes are atomic; latest-by-name wins.

## Env Vars
- OPENCODE_PSA_MODEL, OPENCODE_PSA_DIR, OPENCODE_PSA_WATCH_SEC, OPENCODE_MOCK_DIR

## Tests
- bun test tests/non-llm
- OPENCODE_PSA_MODEL=... bun test tests/llm
- Manual QA: docs/TEST-CASES-MANUAL.md

## Docs
- Contract: .claude/skills/opencode-subagent/SKILL.md
- Tests: docs/TEST-AUTOMATION.md
- Daemon design: docs/PLAN-STATUS-DAEMON.md

## Change Checklist
- CLI changes: update tests + docs; keep wrappers thin.
- Registry/daemon changes: update tests/non-llm/status.daemon.spec.ts + PLAN-STATUS-DAEMON.md.
- Export/session parsing changes: update parser + tests/llm/cli_stability.spec.ts.

## Gotchas
- Registry root is process.cwd(), not --cwd.
- status_watch.sh depends on status --diagram output.
