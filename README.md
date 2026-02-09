# OpenCode Persistent Subagent Skill

This skill lets you run named, persistent OpenCode subagents that you can resume later. You get simple commands to start, check status, fetch the latest answer, search history, and cancel runs—without losing the session thread.

Some of the actions available to main agent (orchestrator):
- Start: `run_subagent.sh --name <name> --prompt <text>`
- Check: `status.sh`
- Result: `result.sh --name <name>`
- Wait for done: `status.sh --name <name> --wait-terminal --timeout 60`
- Wait and fetch: `result.sh --name <name> --wait --timeout 60 --json`

---

## Quick Start

- Copy the skill to valid folder
- In the prompt ask to use the skill, mention the OpenCode cnfigured model to use (e.g. `Use opencode subagents skill, use openai/gpt-5.2 model`
- Launch a seapatw terminal session and watch live stats on running agents
	```bash
	./.claude/skills/opencode-subagent/scripts/status_watch.sh --cwd .
	```

## Requirements

- macOS or Linux
- `opencode` CLI on PATH
- Node.js available as `node`
- A valid model ID (e.g. `opencode/gpt-5-nano`)

## Skill installation

This repo contains the skill in the Claude Code project-local discovery path:

- `.claude/skills/opencode-subagent/`

Copy it to the location discoverable by your agent harness.

### OpenCode

OpenCode will discover it when copied to the folder:

- `.claude/skills/opencode-subagent/`

Global install, copy to:

- `~/.config/opencode/skills/opencode-subagent/`

## Files

- `.claude/skills/opencode-subagent/SKILL.md` — the OpenCode skill definition
- `.claude/skills/opencode-subagent/scripts/` — helper scripts used by the skill
---

## Developer context

- Solution layout: skill lives under `.claude/skills/opencode-subagent/` with scripts in `scripts/` and Node CLI in `bin/`.
- Registry: runs are tracked in `<orchestrator-cwd>/.opencode-subagent/registry.json` (mutable, latest per name).
- Tests: non-LLM uses a deterministic mock `opencode` shim; LLM suite is gated by `OPENCODE_PSA_MODEL`.

### Tests

```bash
bun test tests/non-llm
```

LLM tests are gated by `OPENCODE_PSA_MODEL`:

```bash
OPENCODE_PSA_MODEL=opencode/gpt-5-nano bun test tests/llm
```

### Usage (recommended scripts)

Start a new persistent session (async-only, registry-backed):

```bash
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
	--name "hello" \
	--prompt "Hello world" \
	--model opencode/gpt-5-nano
```

Resume the same session later:

```bash
./.claude/skills/opencode-subagent/scripts/run_subagent.sh \
	--name "hello" \
	--resume \
	--prompt "Continue with follow-ups"
```

Fetch just the last assistant result (no huge JSON dump):

```bash
./.claude/skills/opencode-subagent/scripts/result.sh --name "hello"
```

Search the subagent history (grep-like):

```bash
./.claude/skills/opencode-subagent/scripts/search.sh \
	--name "hello" \
	--pattern "closures|async"
```

### Notes

If `opencode run` fails quickly, verify that your model ID is valid.
Example known-good model:

```
opencode/gpt-5-nano
```

---
