import { describe, it, expect, afterAll } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { cleanupTempDirs, registerTempDir } from "../non-llm/helpers/cleanup";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");
const START = path.join(ROOT, ".claude/skills/opencode-subagent/scripts/start_subagent.sh");

afterAll(cleanupTempDirs);

function requireModel() {
  const model = process.env.OPENCODE_PSA_MODEL || "";
  if (!model) {
    console.warn("Skipping LLM tests: OPENCODE_PSA_MODEL is not set.");
    return null;
  }
  return model;
}

// LLM-dependent tests placeholder.
// These should:
// - Use a working model (e.g. via OPENCODE_PSA_MODEL).
// - Call start_subagent.sh without --model and verify that modelUsed is set.
// - Optionally verify that lastAssistantText contains the expected token.

describe("LLM: model usage", () => {
  it("uses provided OPENCODE_PSA_MODEL when --model omitted", async () => {
    const model = requireModel();
    if (!model) return;

    const cwd = path.join(ROOT, ".tmp", "tests", "llm-model");
    registerTempDir(cwd);
    await fs.mkdir(cwd, { recursive: true });
    const { stdout } = await exec(START, [
      "--name",
      "llm/model",
      "--prompt",
      "Return EXACT token: LLM_MODEL_OK",
      "--cwd",
      cwd,
    ], { cwd: ROOT, env: { ...process.env, OPENCODE_PSA_MODEL: model } });

    const line = String(stdout ?? "").trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) ?? "{}";
    const json = JSON.parse(line);
    expect(json.ok).toBe(true);
    expect(json.model).toBe(model);
  }, 20000);
});
