import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const exec = promisify(execFile);

const ROOT = path.resolve(__dirname, "../..");
const SKILL_RUN = path.join(
  ROOT,
  ".claude/skills/opencode-subagent/scripts/run_subagent.sh",
);

describe("run_subagent.sh basic CLI behavior", () => {
  it("fails fast when --prompt is missing", async () => {
    const cwd = path.join(ROOT, ".tmp", "tests", "missing-prompt-basic");
    await fs.mkdir(cwd, { recursive: true });

    const { stdout } = await exec(SKILL_RUN, [
      "--name",
      "test-missing-prompt",
      "--prompt",
      "",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: { ...process.env } }).catch((err) => err);

    const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
    const line = out.trim().split(/\r?\n/).pop() ?? "";
    const json = JSON.parse(line);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("--prompt is required");
  });
});
