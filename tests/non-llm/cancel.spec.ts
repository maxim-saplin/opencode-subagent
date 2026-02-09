import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "bun:test";
import { mockEnv, scriptPath } from "./helpers/mock-opencode";
import { cleanupTempDirs } from "./helpers/cleanup";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

afterAll(cleanupTempDirs);

const RUN = scriptPath("run_subagent.sh");
const CANCEL = scriptPath("cancel.sh");
const STATUS = scriptPath("status.sh");

describe("cancel.sh behavior", () => {
  it("cancels a running agent", { timeout: 15000 }, async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "cancel-run");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "cancel-agent",
      "--prompt",
      "MOCK:SLEEP:5 MOCK:REPLY:NEVER",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    for (let i = 0; i < 50; i += 1) {
      const { stdout } = await exec(STATUS, ["--name", "cancel-agent", "--cwd", cwd], { cwd, env: mockEnv(cwd) });
      const statusJson = JSON.parse(String(stdout ?? "").trim());
      const agent = statusJson.agents?.[0];
      if (agent && agent.status === "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const { stdout } = await exec(CANCEL, ["--name", "cancel-agent", "--cwd", cwd], { cwd, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
  });

  it("errors when agent is done", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "cancel-done");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "cancel-done-agent",
      "--prompt",
      "MOCK:REPLY:DONE",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    for (let i = 0; i < 20; i += 1) {
      const { stdout } = await exec(STATUS, ["--name", "cancel-done-agent", "--cwd", cwd], { cwd, env: mockEnv(cwd) });
      const statusJson = JSON.parse(String(stdout ?? "").trim());
      const agent = statusJson.agents?.[0];
      if (agent && agent.status === "done") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const res = await exec(CANCEL, ["--name", "cancel-done-agent", "--cwd", cwd], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);
    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });

  it("errors when agent missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "cancel-missing");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(CANCEL, ["--name", "missing", "--cwd", cwd], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);
    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });
});
