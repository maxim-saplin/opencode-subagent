import { describe, it, expect, afterAll } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { cleanupTempDirs, registerTempDir } from "../non-llm/helpers/cleanup";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");
const START = path.join(ROOT, ".claude/skills/opencode-subagent/scripts/start_subagent.sh");
const RESUME = path.join(ROOT, ".claude/skills/opencode-subagent/scripts/resume_subagent.sh");
const STATUS = path.join(ROOT, ".claude/skills/opencode-subagent/scripts/status.sh");

afterAll(cleanupTempDirs);

function requireModel() {
  const model = process.env.OPENCODE_PSA_MODEL || "";
  if (!model) {
    console.warn("Skipping LLM tests: OPENCODE_PSA_MODEL is not set.");
    return null;
  }
  return model;
}

function parseLine(stdout: string) {
  return JSON.parse(
    String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}",
  );
}

async function waitForDone(cwd: string, name: string, timeoutSec = 60) {
  const { stdout } = await exec(STATUS, ["--name", name, "--cwd", cwd], { cwd });
  const json = JSON.parse(String(stdout ?? "").trim() || "{}");
  const agents = json.agents || [];
  if (agents.some((a: any) => a.name === name && a.status === "done")) return;

  await exec(STATUS, ["--name", name, "--wait-terminal", "--cwd", cwd], {
    cwd,
    timeout: timeoutSec * 1000,
    env: { ...process.env, OPENCODE_PSA_WAIT_TIMEOUT_SEC: String(timeoutSec) },
  });
}

async function waitForUsage(cwd: string, name: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    try {
      const { stdout } = await exec(STATUS, ["--name", name, "--cwd", cwd], { cwd });
      const json = JSON.parse(String(stdout ?? "").trim() || "{}");
      const agent = (json.agents || []).find((a: any) => a.name === name);
      lastStatus = JSON.stringify(agent?.usage ?? null);
      if (agent?.usage?.dialogTokens != null && agent.usage.dialogTokens > 0) {
        return agent;
      }
    } catch (e: any) {
      lastStatus = `error: ${e.message}`;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for usage on ${name} (last usage: ${lastStatus})`);
}

describe("LLM: dialog token accounting", () => {
  it("L11 dialogTokens includes cached input tokens (cache.read)", async () => {
    const model = requireModel();
    if (!model) return;

    const cwd = path.join(ROOT, ".tmp", "tests", "llm-dialog-tokens");
    registerTempDir(cwd);
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const env = { ...process.env, OPENCODE_PSA_MODEL: model };
    const agentName = `cache-tkn-${Date.now()}`;

    // Turn 1: start session
    const { stdout: startOut } = await exec(
      START,
      ["--name", agentName, "--prompt", "Say hello in one sentence", "--model", model, "--cwd", cwd],
      { cwd, env },
    );
    expect(parseLine(startOut).ok).toBe(true);
    await waitForDone(cwd, agentName, 90);

    // Turn 2: resume -- prior context should now be cached by the provider
    const { stdout: resumeOut } = await exec(
      RESUME,
      ["--name", agentName, "--prompt", "Now say goodbye in one sentence", "--cwd", cwd],
      { cwd, env },
    );
    expect(parseLine(resumeOut).ok).toBe(true);
    await waitForDone(cwd, agentName, 90);

    // Wait for daemon to populate usage
    const agent = await waitForUsage(cwd, agentName, 45000);
    const reportedDialogTokens: number = agent.usage.dialogTokens;

    // Read registry to get sessionId
    const registryPath = path.join(cwd, ".opencode-subagent", "registry.json");
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
    const sessionId = registry.agents[agentName]?.sessionId;
    expect(sessionId).toBeTruthy();

    // Export the session and find the last assistant message with tokens
    const stdout = execFileSync("opencode", ["export", sessionId], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    const exportData = JSON.parse(String(stdout));
    const messages = exportData.messages || [];
    expect(messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant

    let lastInput = 0;
    let lastCacheRead = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const info = m?.info || {};
      if (info.role !== "assistant") continue;
      const tokens = info.tokens || {};
      const input = tokens.input ?? 0;
      const cacheRead = tokens.cache?.read ?? 0;
      if (input > 0 || cacheRead > 0) {
        lastInput = input;
        lastCacheRead = cacheRead;
        break;
      }
    }

    const expectedDialogTokens = lastInput + lastCacheRead;

    console.log(`  last assistant: input=${lastInput}, cache.read=${lastCacheRead}`);
    console.log(`  expected dialogTokens: ${expectedDialogTokens}`);
    console.log(`  reported dialogTokens: ${reportedDialogTokens}`);

    if (lastCacheRead === 0) {
      console.warn("  WARN: cache.read=0 on final message; provider may not report cache tokens. Test inconclusive.");
      return;
    }

    // This assertion verifies that dialogTokens = input + cache.read (not just input).
    expect(reportedDialogTokens).toBe(expectedDialogTokens);
  }, 240000);
});
