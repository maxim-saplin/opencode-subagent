import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it, expect, afterAll } from "bun:test";
import { mockEnv, scriptPath } from "./helpers/mock-opencode";
import { cleanupTempDirs } from "./helpers/cleanup";
import { waitForStatusDone } from "./helpers/wait";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

afterAll(cleanupTempDirs);

const START = scriptPath("start_subagent.sh");
const STATUS = scriptPath("status.sh");

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (await fn()) return;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await delay(intervalMs);
  }
}

async function readRegistry(cwd: string) {
  const file = path.join(cwd, ".opencode-subagent", "registry.json");
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

async function fetchStatus(cwd: string, name?: string) {
  const args = ["--cwd", cwd];
  if (name) args.unshift("--name", name);
  const { stdout } = await exec(STATUS, args, { env: mockEnv(cwd), cwd });
  return JSON.parse(String(stdout ?? "").trim() || "{}");
}

function isPidAlive(pid: number) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("status daemon + usage cache", () => {
  it("spawns daemon when agent starts", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-spawn");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-spawn-agent",
      "--prompt",
      "MOCK:SLEEP:2 MOCK:REPLY:OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForCondition(async () => {
      try {
        const registry = await readRegistry(cwd);
        return Boolean(registry.daemon && Number.isFinite(registry.daemon.pid));
      } catch {
        return false;
      }
    });

    const registry = await readRegistry(cwd);
    expect(registry.daemon).toBeTruthy();
    expect(isPidAlive(Number(registry.daemon.pid))).toBe(true);
  }, 20000);

  it("exits daemon when no active agents remain", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-exit");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-exit-agent",
      "--prompt",
      "MOCK:SLEEP:1 MOCK:REPLY:OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "daemon-exit-agent", 10);

    await waitForCondition(async () => {
      try {
        const registry = await readRegistry(cwd);
        const daemon = registry.daemon;
        if (!daemon || !daemon.pid) return true;
        return !isPidAlive(Number(daemon.pid));
      } catch {
        return false;
      }
    }, 10000);
  }, 30000);

  it("updates running usage with tokens", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-running");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-running-agent",
      "--prompt",
      "MOCK:SLEEP:5 MOCK:REPLY:USAGE",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForCondition(async () => {
      const json = await fetchStatus(cwd, "daemon-running-agent");
      const agent = (json.agents || [])[0];
      if (!agent || agent.status !== "running") return false;
      return Boolean(agent.usage && agent.usage.messageCount > 0 && agent.usage.dialogTokens > 0);
    }, 10000, 250);
  }, 30000);

  it("finalizes done usage", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-done");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-done-agent",
      "--prompt",
      "MOCK:REPLY:FINAL",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "daemon-done-agent", 10);

    await waitForCondition(async () => {
      const json = await fetchStatus(cwd, "daemon-done-agent");
      const agent = (json.agents || [])[0];
      return Boolean(agent && agent.usage && agent.usage.messageCount >= 2 && agent.usage.dialogTokens > 0);
    });
  }, 20000);

  it("logs export failures without surfacing them in status", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-log");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-log-anchor",
      "--prompt",
      "MOCK:SLEEP:5 MOCK:REPLY:OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const registryDir = path.join(cwd, ".opencode-subagent");
    await fs.mkdir(registryDir, { recursive: true });

    await waitForCondition(async () => {
      try {
        await fs.access(path.join(registryDir, "registry.json"));
        return true;
      } catch {
        return false;
      }
    });

    const registry = await readRegistry(cwd);
    const now = new Date().toISOString();
    registry.agents = registry.agents || {};
    registry.agents["bad-session"] = {
      name: "bad-session",
      pid: null,
      sessionId: "ses_missing",
      status: "done",
      exitCode: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      model: "opencode/gpt-5-nano",
      prompt: "bad session",
      cwd,
    };
    await fs.writeFile(path.join(registryDir, "registry.json"), JSON.stringify(registry), "utf8");

    const logFile = path.join(registryDir, "usage-export.log");
    await waitForCondition(async () => {
      try {
        const log = await fs.readFile(logFile, "utf8");
        return log.includes("\"name\":\"bad-session\"");
      } catch {
        return false;
      }
    }, 10000, 250);

    const json = await fetchStatus(cwd, "bad-session");
    const agent = (json.agents || [])[0];
    expect(agent).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(agent, "usageError")).toBe(false);
  }, 30000);

  it("renders status diagram", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-daemon-diagram");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "daemon-diagram-agent",
      "--prompt",
      "MOCK:REPLY:DIAGRAM",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "daemon-diagram-agent", 10);

    const { stdout } = await exec(STATUS, ["--diagram", "--cwd", cwd], { env: mockEnv(cwd), cwd });
    const output = String(stdout || "");
    expect(output).toContain("NAME");
    expect(output).toContain("STATUS");
    expect(output).toContain("PID");
    expect(output).toContain("MSG");
    expect(output).toContain("DIALOG");
    expect(output).toContain("FULL");
  }, 20000);
});
