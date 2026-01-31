import { describe, it, expect } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

function requireModel() {
  const model = process.env.OPENCODE_PSA_MODEL || "";
  if (!model) {
    console.warn("Skipping LLM tests: OPENCODE_PSA_MODEL is not set.");
    return null;
  }
  return model;
}

describe("LLM: CLI stability checks", () => {
  it("L08 session list JSON schema", async () => {
    const model = requireModel();
    if (!model) return;

    const { stdout } = await exec("opencode", ["session", "list", "--format", "json"], { cwd: ROOT });
    const json = JSON.parse(String(stdout ?? "").trim() || "{}");
    const sessions = Array.isArray(json.sessions) ? json.sessions : Array.isArray(json) ? json : [];
    if (sessions.length > 0) {
      const s = sessions[0];
      expect(!!(s.id || s.sessionId)).toBe(true);
      expect(typeof s.title === "string").toBe(true);
      expect(s.created !== undefined || s.updated !== undefined).toBe(true);
    }
  });

  it("L09 export JSON schema", async () => {
    const model = requireModel();
    if (!model) return;

    const { stdout: listOut } = await exec("opencode", ["session", "list", "--format", "json"], { cwd: ROOT });
    const list = JSON.parse(String(listOut ?? "").trim() || "{}");
    const sessions = Array.isArray(list.sessions) ? list.sessions : Array.isArray(list) ? list : [];
    if (sessions.length === 0) return;

    const id = sessions[0].id || sessions[0].sessionId;
    const { stdout } = await exec("opencode", ["export", id], { cwd: ROOT });
    const json = JSON.parse(String(stdout ?? "").trim() || "{}");
    expect(Array.isArray(json.messages)).toBe(true);
    const modelInfo = json.info?.model || json.info?.modelID || json.info?.modelId;
    const messageModel = Array.isArray(json.messages)
      ? json.messages.find((m: any) => m?.info?.model || m?.info?.modelID || m?.info?.modelId)?.info?.model
      : null;
    expect(!!(modelInfo || messageModel)).toBe(true);
  });

  it("L10 run creates discoverable session", async () => {
    const model = requireModel();
    if (!model) return;
    const title = `psa/llm/stability/${Date.now()}`;

    const child = spawn("opencode", ["run", "Return EXACT token: L10_OK", "--model", model, "--title", title], {
      cwd: ROOT,
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    const deadline = Date.now() + 50000;
    let found = false;
    while (Date.now() < deadline) {
      const { stdout } = await exec("opencode", ["session", "list", "--format", "json"], { cwd: ROOT });
      const json = JSON.parse(String(stdout ?? "").trim() || "{}");
      const sessions = Array.isArray(json.sessions) ? json.sessions : Array.isArray(json) ? json : [];
      found = sessions.some((s: any) => s.title === title || s.name === title);
      if (found) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(found).toBe(true);
  }, 60000);
});
