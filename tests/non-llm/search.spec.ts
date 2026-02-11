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

const START = scriptPath("start_subagent.sh");
const SEARCH = scriptPath("search.sh");

describe("search.sh behavior", () => {
  it("finds assistant matches", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "search-ok");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "search-agent",
      "--prompt",
      "MOCK:REPLY:SEARCH_OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "search-agent");

    const { stdout } = await exec(SEARCH, [
      "--name",
      "search-agent",
      "--pattern",
      "SEARCH_OK",
      "--role",
      "assistant",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(json.matches.length).toBeGreaterThan(0);
  });

  it("errors when pattern missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "search-missing");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(SEARCH, [
      "--name",
      "search-missing",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });
});
