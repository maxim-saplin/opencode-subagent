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

describe("registry mechanics", () => {
  it("dedupes by name in status output", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "registry-dedupe");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "dedupe-agent",
      "--prompt",
      "MOCK:REPLY:ONE",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    await exec(RUN, [
      "--name",
      "dedupe-agent",
      "--prompt",
      "MOCK:REPLY:TWO",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const { stdout } = await exec(STATUS, ["--name", "dedupe-agent", "--json", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.agents.length).toBe(1);
    expect(json.agents[0].name).toBe("dedupe-agent");
  });

  it("runs.jsonl is append-only with newline separation", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "registry-lines");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "lines-agent",
      "--prompt",
      "MOCK:REPLY:LINES",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const runs = await fs.readFile(path.join(cwd, ".opencode-subagent", "runs.jsonl"), "utf8");
    const lines = runs.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith("{"))
        .toBe(true);
    }
  });
});
