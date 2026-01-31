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
const STATUS = scriptPath("status.sh");

describe("status.sh v2 behavior", () => {
  it("filters by name", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-filter");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "status-one",
      "--prompt",
      "MOCK:REPLY:ONE",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    await exec(RUN, [
      "--name",
      "status-two",
      "--prompt",
      "MOCK:REPLY:TWO",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const { stdout } = await exec(STATUS, ["--name", "status-two", "--json", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.agents.length).toBe(1);
    expect(json.agents[0].name).toBe("status-two");
  });

  it("wait mode returns changes", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-wait");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "status-wait-agent",
      "--prompt",
      "MOCK:SLEEP:2 MOCK:REPLY:DONE",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const { stdout } = await exec(STATUS, ["--wait", "--timeout", "10", "--json", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.changed)).toBe(true);
  }, 30000);
});
