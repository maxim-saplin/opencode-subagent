# OpenCode Persistent Subagent Skill (macOS-friendly)

This repo contains a **spec-compliant OpenCode skill** that helps an orchestrator run **persistent, resumable subagent sessions** via the OpenCode CLI.

It also includes a legacy PID-based runner script.

---

## Files

- `.opencode/skills/opencode-persistent-subagent/SKILL.md` — the OpenCode skill definition
- `.opencode/skills/opencode-persistent-subagent/scripts/` — helper scripts used by the skill
- `opencode-subagent.sh` — legacy runner script (PID-based, macOS only)

---

## Requirements

- macOS
- `opencode` CLI on PATH
- `osascript` (built-in on macOS)
- A valid model ID (e.g. `opencode/gpt-5-nano`)

---

## Skill installation

This repo already places the skill in the project-local discovery path:

- `.opencode/skills/opencode-persistent-subagent/SKILL.md`

OpenCode will discover it when running inside this git worktree (unless skills are disabled or denied by permissions).

To install globally instead, copy the folder:

- `.opencode/skills/opencode-persistent-subagent/`

to:

- `~/.config/opencode/skills/opencode-persistent-subagent/`

## Usage (recommended scripts)

Start a new persistent session (creates a human-readable title and stores the `sessionId` mapping in an index file under the working directory):

```bash
./.opencode/skills/opencode-persistent-subagent/scripts/run_subagent.sh \
	--name "hello" \
	--prompt "Hello world" \
	--model opencode/gpt-5-nano
```

Resume the same session later:

```bash
./.opencode/skills/opencode-persistent-subagent/scripts/run_subagent.sh \
	--name "hello" \
	--resume \
	--prompt "Continue with follow-ups"
```

Fetch just the last assistant result (no huge JSON dump):

```bash
./.opencode/skills/opencode-persistent-subagent/scripts/extract_last.sh --name "hello"
```

Search the subagent history (grep-like):

```bash
./.opencode/skills/opencode-persistent-subagent/scripts/search_history.sh \
	--name "hello" \
	--pattern "closures|async"
```

## Legacy usage (PID-based runner)

```bash
chmod +x opencode-subagent.sh

./opencode-subagent.sh "Hello world" opencode/gpt-5-nano
```

You can also set a custom working directory:

```bash
./opencode-subagent.sh "Summarize README" opencode/gpt-5-nano /path/to/project
```

---

## Legacy status contract

This skill reports status based **only** on process lifecycle:

- **RUNNING** while the PID is alive
- **ENDED** after the subprocess exits

No other status is reliable without server API access. This legacy script does not return a `sessionId` and cannot resume sessions.

---

## Legacy output contract

The script writes status signals to stdout:

```
SUBAGENT_PID=<pid>
SUBAGENT_STATUS=RUNNING
...
SUBAGENT_STATUS=ENDED
SUBAGENT_EXIT_CODE=<code>
```

---

## Why PID-based status

OpenCode CLI does not expose a simple “job status” API, so PID tracking is a deterministic lifecycle signal.

For **persistence/resume**, use the skill scripts, which address sessions using `sessionId` and retrieve results via `opencode export`.

---

## Notes

If `opencode run` fails quickly, verify that your model ID is valid.  
Example known-good model:

```
opencode/gpt-5-nano
```

---