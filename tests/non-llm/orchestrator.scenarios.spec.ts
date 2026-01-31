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
const STATUS = scriptPath("status.sh");
const RESULT = scriptPath("result.sh");
const SEARCH = scriptPath("search.sh");
const CANCEL = scriptPath("cancel.sh");

async function waitDone(cwd: string, name?: string, timeout = 20) {
  await waitForStatusDone(cwd, name, timeout);
}

describe("orchestrator scenarios (deterministic)", () => {
  it("A01 single agent lifecycle", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A01");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a01/one", "--prompt", "MOCK:SLEEP:2 MOCK:REPLY:A01_OK", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a01/one");

    const { stdout } = await exec(RESULT, ["--name", "a01/one", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.lastAssistantText).toBe("A01_OK");
  });

  it("A02 fan-out and completion", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A02");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a02/fast", "--prompt", "MOCK:SLEEP:2 MOCK:REPLY:FAST", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await exec(RUN, ["--name", "a02/slow", "--prompt", "MOCK:SLEEP:3 MOCK:REPLY:SLOW", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });

    await waitDone(cwd, "a02/fast");
    await waitDone(cwd, "a02/slow");

    const fast = await exec(RESULT, ["--name", "a02/fast", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    const slow = await exec(RESULT, ["--name", "a02/slow", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(fast.stdout ?? "").trim()).lastAssistantText).toBe("FAST");
    expect(JSON.parse(String(slow.stdout ?? "").trim()).lastAssistantText).toBe("SLOW");
  }, 20000);

  it("A03 resume same session", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A03");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a03/handshake", "--prompt", "MOCK:REPLY:ACK1", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a03/handshake");

    await exec(RUN, ["--name", "a03/handshake", "--resume", "--prompt", "MOCK:REPLY:ACK2", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a03/handshake");

    const { stdout } = await exec(RESULT, ["--name", "a03/handshake", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(stdout ?? "").trim()).lastAssistantText).toBe("ACK2");
  });

  it("A04 cancel long-running task", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A04");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a04/long", "--prompt", "MOCK:SLEEP:5 MOCK:REPLY:LONG", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await exec(CANCEL, ["--name", "a04/long", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    const { stdout } = await exec(STATUS, ["--name", "a04/long", "--wait", "--timeout", "5", "--json", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    const json = JSON.parse(String(stdout ?? "").trim());
    expect(json.ok).toBe(true);
  }, 20000);

  it("A05 file attachment echo", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A05");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, [
      "--name",
      "a05/attach",
      "--prompt",
      "MOCK:ATTACH",
      "--file",
      path.join(ROOT, "tests", "fixtures", "attachment-token.txt"),
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: mockEnv(cwd) });

    await waitDone(cwd, "a05/attach");
    const { stdout } = await exec(RESULT, ["--name", "a05/attach", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(stdout ?? "").trim()).lastAssistantText).toBe("PSA_ATTACHMENT_OK");
  });

  it("A06 failure and retry", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A06");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a06/retry", "--prompt", "MOCK:EXIT:1", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a06/retry");

    await exec(RUN, ["--name", "a06/retry", "--prompt", "MOCK:REPLY:RECOVERED", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a06/retry");

    const { stdout } = await exec(RESULT, ["--name", "a06/retry", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(stdout ?? "").trim()).lastAssistantText).toBe("RECOVERED");
  });

  it("A07 concurrency cap (max 3)", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A07");
    await fs.mkdir(cwd, { recursive: true });

    const tasks = Array.from({ length: 10 }, (_, i) => `a07/task-${i + 1}`);
    const inFlight: Promise<void>[] = [];
    let active = 0;
    let maxActive = 0;

    const launch = async (name: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await exec(RUN, ["--name", name, "--prompt", "MOCK:SLEEP:1 MOCK:REPLY:OK", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
      await waitDone(cwd, name);
      active -= 1;
    };

    for (const name of tasks) {
      while (active >= 3) {
        await new Promise((r) => setTimeout(r, 100));
      }
      inFlight.push(launch(name));
    }

    await Promise.all(inFlight);
    expect(maxActive).toBeLessThanOrEqual(3);
  }, 60000);

  it("A08 restart and resume", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "A08");
    await fs.mkdir(cwd, { recursive: true });

    await exec(RUN, ["--name", "a08/resume", "--prompt", "MOCK:REPLY:RESUME_OK", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a08/resume");

    const status = await exec(STATUS, ["--name", "a08/resume", "--json", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(status.stdout ?? "").trim()).agents.length).toBe(1);

    await exec(RUN, ["--name", "a08/resume", "--resume", "--prompt", "MOCK:REPLY:RESUME_CONTINUE_OK", "--cwd", cwd], { cwd: ROOT, env: mockEnv(cwd) });
    await waitDone(cwd, "a08/resume");

    const { stdout } = await exec(RESULT, ["--name", "a08/resume", "--cwd", cwd, "--json"], { cwd: ROOT, env: mockEnv(cwd) });
    expect(JSON.parse(String(stdout ?? "").trim()).lastAssistantText).toBe("RESUME_CONTINUE_OK");
  }, 20000);
});
