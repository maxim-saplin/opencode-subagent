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

afterAll(cleanupTempDirs);

const RUN = scriptPath("run_subagent.sh");
const RESULT = scriptPath("result.sh");

describe("result.sh v2 behavior", () => {
  it("errors for unknown name", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-unknown");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(RESULT, ["--name", "missing", "--cwd", cwd, "--json"], {
      cwd: ROOT,
      env: mockEnv(cwd),
    }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });

  it("returns last assistant text", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "result-ok");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "result-agent",
      "--prompt",
      "MOCK:REPLY:RESULT_OK",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "result-agent");

    const { stdout } = await exec(RESULT, ["--name", "result-agent", "--cwd", cwd, "--json"], {
      cwd: ROOT,
      env: mockEnv(cwd),
    });

    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(json.lastAssistantText).toBe("RESULT_OK");
  });
});
