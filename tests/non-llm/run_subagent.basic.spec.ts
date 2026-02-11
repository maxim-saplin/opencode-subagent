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

  it("passes --variant through (not echoed in output, stored in registry)", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "variant-output-basic");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const { stdout } = await exec(START, [
      "--name",
      "test-variant-output",
      "--prompt",
      "MOCK:REPLY:OK",
      "--variant",
      "high",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const line = String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}";
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.variant).toBeUndefined();
    expect(json.sessionId).toBeUndefined();
  });

  it("omits variant and sessionId from output when not relevant", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "variant-null-basic");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const { stdout } = await exec(START, [
      "--name",
      "test-variant-null",
      "--prompt",
      "MOCK:REPLY:OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const line = String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}";
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.variant).toBeUndefined();
    expect(json.sessionId).toBeUndefined();
  });
});
