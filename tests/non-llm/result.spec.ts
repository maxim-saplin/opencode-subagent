import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "bun:test";
import { mockEnv, scriptPath } from "./helpers/mock-opencode";
import { waitForStatusDone } from "./helpers/wait";
import { cleanupTempDirs } from "./helpers/cleanup";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

async function readContractMajor() {
  const text = await fs.readFile(path.join(ROOT, "package.json"), "utf8");
  const json = JSON.parse(text);
  const match = String(json && json.version ? json.version : "").match(/^(\d+)/);
  const major = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(major) || major <= 0) throw new Error("Invalid package.json version");
  return Math.trunc(major);
}

afterAll(cleanupTempDirs);

const START = scriptPath("start_subagent.sh");
const RESULT = scriptPath("result.sh");

describe("result.sh behavior", () => {
  it("errors for unknown name", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-unknown");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(RESULT, ["--name", "missing", "--cwd", cwd, "--json"], {
      cwd,
      env: mockEnv(cwd),
    }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });

  it("returns last assistant text when done", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-ok");
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "result-agent",
      "--prompt",
      "MOCK:REPLY:RESULT_OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "result-agent");

    const { stdout } = await exec(RESULT, [
      "--name",
      "result-agent",
      "--cwd",
      cwd,
      "--json",
    ], {
      cwd,
      env: mockEnv(cwd),
    });

    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(json.lastAssistantText).toBe("RESULT_OK");
  });

  it("uses registry under orchestrator working dir", async () => {
    const root = path.join(ROOT, ".tmp", "tests", "result-root");
    const target = path.join(root, "work");
    await fs.mkdir(target, { recursive: true });
    await fs.rm(path.join(root, ".opencode-subagent"), { recursive: true, force: true });

    await exec(START, [
      "--name",
      "root-agent",
      "--prompt",
      "MOCK:REPLY:ROOT_OK",
      "--cwd",
      target,
    ], { cwd: root, env: mockEnv(target) });

    await waitForStatusDone(root, "root-agent");

    const { stdout } = await exec(RESULT, [
      "--name",
      "root-agent",
      "--json",
    ], {
      cwd: root,
      env: mockEnv(target),
    });

    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(json.lastAssistantText).toBe("ROOT_OK");
  });

  it("returns status immediately when agent is running", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-running");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "running-agent",
      "--prompt",
      "MOCK:SLEEP:5 MOCK:REPLY:LATER",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    for (let i = 0; i < 50; i += 1) {
      const status = await exec(RESULT, ["--name", "running-agent", "--cwd", cwd, "--json"], { cwd, env: mockEnv(cwd) });
      const json = JSON.parse(String(status.stdout ?? "").trim());
      if (json.ok && (json.status === "running" || json.status === "scheduled")) {
        expect(json.lastAssistantText).toBeNull();
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Agent did not reach running/scheduled in time");
  });

  it("fails fast when sessionId is missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-missing-session");
    await fs.mkdir(path.join(cwd, ".opencode-subagent"), { recursive: true });

    const registryPath = path.join(cwd, ".opencode-subagent", "registry.json");
    const record = {
      version: await readContractMajor(),
      agents: {
        "missing-session": {
          name: "missing-session",
          pid: null,
          sessionId: null,
          status: "done",
          exitCode: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          model: "opencode/gpt-5-nano",
          prompt: "test",
          cwd,
        },
      },
    };
    await fs.writeFile(registryPath, JSON.stringify(record), "utf8");

    const res = await exec(RESULT, ["--name", "missing-session", "--cwd", cwd, "--json"], {
      cwd,
      env: mockEnv(cwd),
    }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });
});
