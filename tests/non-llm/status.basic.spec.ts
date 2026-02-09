import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "bun:test";
import { mockEnv, scriptPath } from "./helpers/mock-opencode";
import { cleanupTempDirs } from "./helpers/cleanup";

const exec = promisify(execFile);

afterAll(cleanupTempDirs);

const ROOT = path.resolve(__dirname, "../..");
const SKILL_RUN = scriptPath("run_subagent.sh");
const STATUS = scriptPath("status.sh");

describe("status.sh basic list after scheduled", () => {
  it("shows the agent in the list", { timeout: 20000 }, async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "status-basic");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const run = await exec(SKILL_RUN, [
      "--name",
      "status-basic-agent",
      "--prompt",
      "MOCK:REPLY:STATUS_OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const lines = run.stdout.trim().split(/\r?\n/);
    const jsonLine = lines.find((l) => l.trim().startsWith("{")) ?? lines[0] ?? "";
    const json = JSON.parse(jsonLine);
    expect(json.ok).toBe(true);
    expect(json.name).toBe("status-basic-agent");

    const { stdout } = await exec(STATUS, ["--cwd", cwd], { cwd, env: mockEnv(cwd) });
    const compact = stdout.replace(/\r?\n/g, "");
    const statusJson = JSON.parse(compact);
    const names = (statusJson.agents || []).map((a: any) => a.name);
    expect(names).toContain("status-basic-agent");
  });
});
