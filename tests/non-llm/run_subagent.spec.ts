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

describe("run_subagent.sh behavior", () => {
  it("fails when --name is missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-missing-name");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(RUN, [
      "--prompt",
      "MOCK:REPLY:HELLO",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) }).catch((err: unknown) => err);

    const stdout = (res as { stdout?: string }).stdout ?? "";
    const line = String(stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
    const json = JSON.parse(line);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("--name is required");
  });

  it("writes a scheduled record", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-scheduled");
    await fs.mkdir(cwd, { recursive: true });

    const { stdout } = await exec(RUN, [
      "--name",
      "run-scheduled-agent",
      "--prompt",
      "MOCK:REPLY:SCHEDULED_OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const line = String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}";
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.status).toBe("scheduled");

    const registry = await fs.readFile(path.join(cwd, ".opencode-subagent", "registry.json"), "utf8");
    const parsed = JSON.parse(registry);
    const record = parsed.agents?.["run-scheduled-agent"];
    expect(record).toBeTruthy();
    expect(["scheduled", "running"]).toContain(record.status);
  });

  it("resumes a named session", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-resume");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "resume-agent",
      "--prompt",
      "MOCK:REPLY:ACK1",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "resume-agent");

    const { stdout } = await exec(RUN, [
      "--name",
      "resume-agent",
      "--resume",
      "--prompt",
      "MOCK:REPLY:ACK2",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    const line = String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}";
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("resume");
  });

  it("supports file attachment", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-attach");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "attach-agent",
      "--prompt",
      "MOCK:ATTACH",
      "--file",
      path.join(ROOT, "tests", "fixtures", "attachment-token.txt"),
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "attach-agent");

    const { stdout } = await exec(RESULT, [
      "--name",
      "attach-agent",
      "--wait",
      "--timeout",
      "10",
      "--cwd",
      cwd,
      "--json",
    ], {
      cwd,
      env: mockEnv(cwd),
    });

    const line = String(stdout ?? "").trim();
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.lastAssistantText).toBe("PSA_ATTACHMENT_OK");
  });
});
