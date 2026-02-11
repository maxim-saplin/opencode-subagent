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

const START = scriptPath("start_subagent.sh");

describe("registry mechanics", () => {
  it("rejects duplicate names", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "registry-dedupe");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "dedupe-agent",
      "--prompt",
      "MOCK:REPLY:ONE",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const res = await exec(START, [
      "--name",
      "dedupe-agent",
      "--prompt",
      "MOCK:REPLY:TWO",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const line = String(stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
    const json = JSON.parse(line);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("E_NAME_EXISTS");
  });

  it("registry.json stores latest by name", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "registry-lines");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "lines-agent",
      "--prompt",
      "MOCK:REPLY:LINES",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const registry = await fs.readFile(path.join(cwd, ".opencode-subagent", "registry.json"), "utf8");
    const parsed = JSON.parse(registry);
    expect(parsed.agents).toBeTruthy();
    expect(parsed.agents["lines-agent"]).toBeTruthy();
  });

  it("handles concurrent registry writes", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "registry-concurrent");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const names = Array.from({ length: 6 }, (_, i) => `concurrent-${i + 1}`);
    await Promise.all(
      names.map((name) =>
        exec(START, [
          "--name",
          name,
          "--prompt",
          "MOCK:REPLY:OK",
          "--cwd",
          cwd,
        ], { cwd, env: mockEnv(cwd) }),
      ),
    );

    const registry = await fs.readFile(path.join(cwd, ".opencode-subagent", "registry.json"), "utf8");
    const parsed = JSON.parse(registry);
    for (const name of names) {
      expect(parsed.agents[name]).toBeTruthy();
    }
  });
});
