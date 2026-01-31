# OpenCode Persistent Subagent Skill (macOS-friendly)

This skill lets you run named, persistent OpenCode subagents that you can resume later. You get simple commands to start, check status, fetch the latest answer, search history, and cancel runs—without losing the session thread.

Quick start:
- Start: `run_subagent.sh --name <name> --prompt <text>`
- Check: `status.sh --json`
- Result: `result.sh --name <name>`

---

## Files

- `.claude/skills/opencode-subagent/SKILL.md` — the OpenCode skill definition (v2)
- `.claude/skills/opencode-subagent/scripts/` — helper scripts used by the skill

---

## Requirements

- macOS
- `opencode` CLI on PATH
- `osascript` (built-in on macOS)
- A valid model ID (e.g. `opencode/gpt-5-nano`)

---

## Skill installation

This repo already places the skill in the project-local discovery path:

- `.claude/skills/opencode-subagent/SKILL.md`

OpenCode will discover it when running inside this git worktree (unless skills are disabled or denied by permissions).

To install globally instead, copy the folder:

- `.claude/skills/opencode-subagent/`

to:

- `~/.config/opencode/skills/opencode-subagent/`

## Tests

```bash
bun test tests/non-llm
```

LLM tests are gated by `OPENCODE_PSA_MODEL`:

```bash
OPENCODE_PSA_MODEL=opencode/gpt-5-nano bun test tests/llm
```

## Developer context

- Solution layout: v2 skill lives under `.claude/skills/opencode-subagent/` with scripts in `scripts/`.
- Registry: runs are tracked in `<cwd>/.opencode-subagent/runs.jsonl` (JSONL, latest per name wins).
- Tests: non‑LLM uses a deterministic mock `opencode` shim; LLM suite is gated by `OPENCODE_PSA_MODEL`.

## Usage (recommended scripts)

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

## Notes

If `opencode run` fails quickly, verify that your model ID is valid.  
Example known-good model:

```
opencode/gpt-5-nano
```

---