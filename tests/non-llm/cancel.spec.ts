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

describe("cancel.sh v2 behavior", () => {
  it("cancels a running agent", { timeout: 15000 }, async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "cancel-run");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "cancel-agent",
      "--prompt",
      "MOCK:SLEEP:2 MOCK:REPLY:NEVER",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const { stdout } = await exec(CANCEL, ["--name", "cancel-agent", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
  });

  it("errors when agent missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "cancel-missing");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(CANCEL, ["--name", "missing", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) }).catch((err: unknown) => err);
    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });
});
