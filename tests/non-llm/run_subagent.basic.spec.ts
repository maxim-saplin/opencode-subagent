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
const START = scriptPath("start_subagent.sh");

describe("start_subagent.sh basic CLI behavior (Bun)", () => {
  it("fails fast when --prompt is missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "missing-prompt-basic");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(START, [
      "--name",
      "test-missing-prompt",
      "--prompt",
      "",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
    const line = out.trim().split(/\r?\n/).pop() ?? "";
    const json = JSON.parse(line);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("--prompt is required");
  });

  it("returns JSON error for invalid --cwd", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "missing-cwd-basic", "missing");

    const res = await exec(START, [
      "--name",
      "test-missing-cwd",
      "--prompt",
      "MOCK:REPLY:OK",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
    const line = out.trim().split(/\r?\n/).pop() ?? "";
    const json = JSON.parse(line);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Invalid --cwd");
  });
});
