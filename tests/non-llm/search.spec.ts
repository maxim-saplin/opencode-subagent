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
const SEARCH = scriptPath("search.sh");

describe("search.sh behavior", () => {
  it("finds assistant matches", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "search-ok");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "search-agent",
      "--prompt",
      "MOCK:REPLY:SEARCH_OK",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

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
      "--json",
    ], { cwd: ROOT, env: mockEnv(cwd) });

    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
    expect(json.matches.length).toBeGreaterThan(0);
  });

  it("errors when pattern missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "search-missing");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(SEARCH, [
      "--name",
      "search-missing",
      "--cwd",
      cwd,
      "--json",
    ], { cwd: ROOT, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(false);
  });
});
