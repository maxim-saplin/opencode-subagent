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
const RESUME = scriptPath("resume_subagent.sh");
const RESULT = scriptPath("result.sh");

describe("start_subagent.sh and resume_subagent.sh behavior", () => {
  it("fails when --name is missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-missing-name");
    await fs.mkdir(cwd, { recursive: true });

    const res = await exec(START, [
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

    const { stdout } = await exec(START, [
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

    await exec(START, [
      "--name",
      "resume-agent",
      "--prompt",
      "MOCK:REPLY:ACK1",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "resume-agent");

    const { stdout } = await exec(RESUME, [
      "--name",
      "resume-agent",
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

    await exec(START, [
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

  it("stores variant in registry record", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-variant-registry");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "variant-reg-agent",
      "--prompt",
      "MOCK:REPLY:VARIANT_OK",
      "--variant",
      "high",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "variant-reg-agent");

    const registry = await fs.readFile(path.join(cwd, ".opencode-subagent", "registry.json"), "utf8");
    const parsed = JSON.parse(registry);
    const record = parsed.agents?.["variant-reg-agent"];
    expect(record).toBeTruthy();
    expect(record.variant).toBe("high");
    expect(record.model).toBe("opencode/gpt-5-nano");
  });

  it("stores null variant when not provided", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "run-no-variant-registry");
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.mkdir(cwd, { recursive: true });

    await exec(START, [
      "--name",
      "no-variant-agent",
      "--prompt",
      "MOCK:REPLY:NO_VARIANT_OK",
      "--cwd",
      cwd,
    ], { cwd, env: mockEnv(cwd) });

    await waitForStatusDone(cwd, "no-variant-agent");

    const registry = await fs.readFile(path.join(cwd, ".opencode-subagent", "registry.json"), "utf8");
    const parsed = JSON.parse(registry);
    const record = parsed.agents?.["no-variant-agent"];
    expect(record).toBeTruthy();
    expect(record.variant).toBeNull();
  });
});
