---
name: opencode-persistent-subagent
description: Run persistent, resumable OpenCode subagent sessions from an orchestrator by creating/continuing sessions via opencode run --session and retrieving compact results via opencode export plus bundled scripts.
compatibility: macOS-focused. Requires opencode CLI and osascript (built-in on macOS). Uses opencode run, opencode session list --format json, and opencode export.
metadata:
  workflow: orchestration
  kind: persistence
---

## What I do

I provide a repeatable pattern for running **persistent and resumable “subagent sessions”** using the OpenCode CLI.

This is intended for orchestrators (or higher-level agents) that need:

- A stable `sessionId` to resume later
- A human-readable logical name (via `--title`) while still using `sessionId` for addressing
- A compact “last answer” result (not a huge exported JSON blob)
- A searchable session history (grep-like) for follow-ups

## When to use me

Use this skill when you need **stateful work across multiple invocations** (implement → review → add tests) and you want to resume the *same* OpenCode session later.

Do **not** use this skill when:

- You just need a quick, one-off answer (`opencode run "..."` is enough)
- You want OpenCode’s built-in task/subagent behavior inside a single parent session (use `@general` / `@explore`)

## Key concepts

- **Title is not an address.** Use `--title` for a human label, but resume by `sessionId` using `--session`.
- **Persistence comes from the OpenCode session store.** Your orchestrator persists *the sessionId mapping*.
- **Results are retrieved via export.** Use `opencode export <sessionId>` and extract what you need.

## Orchestrator contract

Provide:

- `logicalName`: stable human handle (e.g. `auth-impl`, `payments-refactor`)
- `prompt`: the instruction to run now
- Optional: `files[]`: file paths to attach to the prompt
- Optional: `resume=true` to continue the prior session for the same `logicalName`

Return:

- `sessionId`: opaque OpenCode session identifier to resume later
- `lastAssistantText`: last assistant message (best-effort extraction)
- `historyMatches`: optional grep results (best-effort)

## How to run (recommended)

Use the bundled scripts rather than parsing raw OpenCode output.

### Start a new persistent subagent session

```bash
./.claude/skills/opencode-persistent-subagent/scripts/run_subagent.sh \
  --name "auth-impl" \
  --prompt "Implement auth based on docs" \
  --file "specs/auth.md" \
  --file "README.md" \
  --agent "build" \
  --model "opencode/gpt-5-nano"
```

### Resume the same persistent subagent session

```bash
./.claude/skills/opencode-persistent-subagent/scripts/run_subagent.sh \
  --name "auth-impl" \
  --resume \
  --prompt "Now add tests and edge cases"
```

### Fetch a compact “last result” later

```bash
./.claude/skills/opencode-persistent-subagent/scripts/extract_last.sh --name "auth-impl"
```

### Grep-like history search

```bash
./.claude/skills/opencode-persistent-subagent/scripts/search_history.sh \
  --name "auth-impl" \
  --pattern "JWT|refresh token"
```

## Synchronization (sync vs async)

- Default behavior is **synchronous**: the script blocks until `opencode run` exits, then exports and returns a compact result.
- For **parallel runs**, use `--async` to start the process, emit `sessionId` as soon as it is discoverable, and return immediately. Your orchestrator can later call `extract_last.sh` to synchronize.

## Difference vs built-in OpenCode subagents

- Built-in subagents (e.g. `@general`) create child sessions attached to the parent OpenCode session and are navigated inside the UI.
- This skill creates **standalone persistent sessions** intended to be resumed later by `sessionId` (even from a different orchestration step).

## Installation / availability

- Project-local install: this directory (discovered via `.claude/skills/.../SKILL.md`).
- Global install: copy this folder to `~/.config/opencode/skills/opencode-persistent-subagent/`.
- Whether subagents can load this skill is controlled by skill permissions in `opencode.json`. If you don’t want recursive “persistent subagent spawning persistent subagent”, set permissions to `deny` for subagents.

## Reference

See [references/CONTRACT.md](references/CONTRACT.md) for the stable stdout contract emitted by the scripts.
